// Listening to the microphone, live, for the teleprompter.
//
// The same two engines as `speech.swift`, fed from an `AVAudioEngine` tap on
// the default input rather than from a file, and reporting each hypothesis as
// it changes rather than one transcript at the end. Its own file because the
// shape is different in every way that matters: nothing here blocks, nothing
// returns a result, and the caller's callback outlives the call.
//
// Two rules keep the callback safe to hand a Rust context pointer:
//
//   1. Every callback takes the session's lock and checks `stopped` under it,
//      and `stop` sets the flag under the same lock before tearing anything
//      down. So once `stop` returns, no callback is running and none will
//      run — which is what lets Rust free the context the moment it returns.
//      `SFSpeechRecognitionTask` delivers one more result after `cancel()`,
//      which is the case this exists for.
//
//   2. The tap runs on the audio thread and does nothing but copy: the level
//      and the buffers go to a serial queue, and the engines and the callback
//      are only ever touched from there.
import AVFoundation
import Foundation
import Speech

// MARK: - The wire

/// One update, as JSON. `stage` is what the receiver switches on.
private struct Update: Encodable {
    let stage: String
    var text: String? = nil
    var session: Int? = nil
    var level: Double? = nil
    var code: String? = nil
    var message: String? = nil
}

// MARK: - Entry points

/// Starts listening. Returns an opaque handle for `prequel_speech_listen_stop`,
/// or null when nothing could be started — in which case a `failed` update
/// has already been delivered saying why.
@_cdecl("prequel_speech_listen_start")
public func prequel_speech_listen_start(
    _ locale: UnsafePointer<CChar>,
    _ contextual: UnsafePointer<CChar>,
    _ ctx: UnsafeMutableRawPointer?,
    _ onUpdate: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> Void
) -> UnsafeMutableRawPointer? {
    let identifier = String(cString: locale)
    let words = (try? JSONDecoder().decode([String].self, from: Data(String(cString: contextual).utf8))) ?? []

    let session = ListenSession(locale: identifier, contextual: words, ctx: ctx, onUpdate: onUpdate)
    session.start()
    return Unmanaged.passRetained(session).toOpaque()
}

/// Stops listening. No update is delivered after this returns.
@_cdecl("prequel_speech_listen_stop")
public func prequel_speech_listen_stop(_ handle: UnsafeMutableRawPointer?) {
    guard let handle else { return }
    let session = Unmanaged<ListenSession>.fromOpaque(handle).takeRetainedValue()
    session.stop()
}

// MARK: - The session

/// The dB window the level meter maps onto 0–1. The same one the dock's
/// meter uses, so the island's bars and the panel's icon agree about how loud
/// the room is.
private let FLOOR_DB = -42.0
private let CEILING_DB = -6.0

/// How often the level is reported, in seconds. Ten a second is smooth enough
/// for three bars and cheap enough to send to a window for the whole of a take.
private let LEVEL_INTERVAL = 0.1

/// `SFSpeechRecognizer` caps an on-device request at about a minute, and
/// ends it with an error rather than a result. So a request is retired
/// early — at a quiet moment after this long, or at the hard limit whatever
/// is happening — and a fresh one takes over, which the receiver sees as a
/// new session number.
private let REQUEST_SOFT_LIMIT = 45.0
private let REQUEST_HARD_LIMIT = 55.0

/// Quiet enough, for long enough, to cut a request between words.
private let QUIET_LEVEL = 0.08
private let QUIET_SECONDS = 0.3

private final class ListenSession: @unchecked Sendable {
    private let locale: String
    private let contextual: [String]
    private let ctx: UnsafeMutableRawPointer?
    private let onUpdate: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> Void

    /// Guards `stopped` and every callback out — see the header.
    private let lock = NSLock()
    private var stopped = false

    /// Everything but the tap runs here, in order.
    private let queue = DispatchQueue(label: "sh.prequel.listen")
    private let engine = AVAudioEngine()

    /// Which hypothesis the receiver is on. Bumped whenever the engine starts
    /// over from nothing.
    private var session = 0

    private var lastLevelAt = Date.distantPast
    private var quietSince: Date? = nil

    // The macOS 14–25 engine.
    private var recogniser: SFSpeechRecognizer? = nil
    private var request: SFSpeechAudioBufferRecognitionRequest? = nil
    private var task: SFSpeechRecognitionTask? = nil
    private var requestStartedAt = Date()
    /// Which request a callback belongs to, so a straggler from a retired one
    /// cannot restart the engine a second time.
    private var generation = 0

    // The macOS 26 engine.
    private var analyzerTask: Task<Void, Never>? = nil
    private var teardown: (() async -> Void)? = nil

    /// The configuration-change observer, removed on stop or it outlives the session.
    private var observer: NSObjectProtocol? = nil

    init(
        locale: String,
        contextual: [String],
        ctx: UnsafeMutableRawPointer?,
        onUpdate: @escaping @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> Void
    ) {
        self.locale = locale
        self.contextual = contextual
        self.ctx = ctx
        self.onUpdate = onUpdate
    }

    // MARK: Lifecycle

    func start() {
        queue.async { [self] in
            if #available(macOS 26.0, *), SpeechTranscriber.isAvailable {
                startAnalyzer()
            } else {
                startRecogniser()
            }
        }
    }

    func stop() {
        lock.lock()
        stopped = true
        lock.unlock()

        // Synchronous, so the engine has let go of the microphone by the time
        // this returns: the menu-bar recording indicator goes out with it.
        queue.sync { [self] in
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            task?.cancel()
            task = nil
            request?.endAudio()
            request = nil
            if let observer { NotificationCenter.default.removeObserver(observer) }
            observer = nil
            analyzerTask?.cancel()
            analyzerTask = nil
            if let teardown {
                Task { await teardown() }
            }
            teardown = nil
        }
    }

    /// Hands an update to Rust, unless the session has been stopped.
    private func emit(_ update: Update) {
        lock.lock()
        defer { lock.unlock() }
        if stopped { return }

        let data = (try? JSONEncoder().encode(update)) ?? Data("{\"stage\":\"failed\",\"code\":\"FAILED\"}".utf8)
        String(decoding: data, as: UTF8.self).withCString { onUpdate(ctx, $0) }
    }

    private func fail(_ code: String, _ message: String) {
        emit(Update(stage: "failed", code: code, message: message))
    }

    // MARK: The microphone

    /// Opens the default input and hands every buffer to `sink`, on the queue.
    private func openMicrophone(sink: @escaping (AVAudioPCMBuffer) -> Void) -> Bool {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            fail("NO_MICROPHONE", "No microphone is available to listen with.")
            return false
        }

        // A tenth of a second per buffer: short enough that a hypothesis
        // follows the voice, long enough that the queue is not flooded.
        let frames = AVAudioFrameCount(format.sampleRate * LEVEL_INTERVAL)
        input.installTap(onBus: 0, bufferSize: frames, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            // Copied on the audio thread — the engine reuses the buffer once
            // the tap returns — and everything else happens on the queue.
            guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return }
            copy.frameLength = buffer.frameLength
            let bytes = Int(buffer.frameLength) * MemoryLayout<Float>.size
            for channel in 0..<Int(buffer.format.channelCount) {
                if let from = buffer.floatChannelData?[channel], let to = copy.floatChannelData?[channel] {
                    memcpy(to, from, bytes)
                }
            }
            queue.async {
                self.measure(copy)
                sink(copy)
            }
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            fail("NO_MICROPHONE", "The microphone could not be opened: \(error.localizedDescription)")
            return false
        }

        // A microphone unplugged, or the default input changed in System
        // Settings, reconfigures the engine under the tap. The tap survives
        // it — but the engine stops, and has to be started again.
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [weak self] _ in
            guard let strong = self else { return }
            strong.queue.async {
                if strong.engine.isRunning { return }
                try? strong.engine.start()
            }
        }

        return true
    }

    /// Reports the level ten times a second, and tracks how long it has been quiet.
    private func measure(_ buffer: AVAudioPCMBuffer) {
        let level = meter(buffer)
        let now = Date()

        if level < QUIET_LEVEL {
            quietSince = quietSince ?? now
        } else {
            quietSince = nil
        }

        if now.timeIntervalSince(lastLevelAt) >= LEVEL_INTERVAL {
            lastLevelAt = now
            emit(Update(stage: "level", level: level))
        }
    }

    // MARK: macOS 26: SpeechAnalyzer

    @available(macOS 26.0, *)
    private func startAnalyzer() {
        analyzerTask = Task { [self] in
            let wanted = Locale(identifier: locale)
            var resolved = await SpeechTranscriber.supportedLocale(equivalentTo: wanted)
            if resolved == nil {
                resolved = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US"))
            }
            guard let supported = resolved else {
                fail("NO_LOCAL_MODEL", "macOS has no on-device speech model for \(locale).")
                return
            }

            let transcriber = SpeechTranscriber(
                locale: supported,
                transcriptionOptions: [],
                // Volatile results are the running hypothesis: the words the
                // engine currently believes, revised until the final arrives.
                // Fast ones trade accuracy for latency, which is the right
                // trade for a prompter: the follower tolerates a misheard word
                // and the reader does not tolerate a four-second lag.
                reportingOptions: [.volatileResults, .fastResults],
                attributeOptions: []
            )

            do {
                if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                    try await install.downloadAndInstall()
                }
            } catch {
                fail("NO_LOCAL_MODEL", "The speech model could not be installed: \(error.localizedDescription)")
                return
            }

            // The script's own words, for the engine to favour.
            let context = AnalysisContext()
            if !contextual.isEmpty {
                context.contextualStrings[.general] = contextual
            }

            // Built without an input, and started below: the initialiser that
            // takes a sequence starts reading it at once, and an `AsyncStream`
            // read by two tasks traps in the second one. That was a SIGTRAP
            // inside `analyzeSequence` with nothing in the log to say why.
            let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
            let analyzer = SpeechAnalyzer(
                modules: [transcriber],
                options: .init(priority: .userInitiated, modelRetention: .whileInUse)
            )
            do {
                try await analyzer.setContext(context)
            } catch {
                // A vocabulary the engine will not take is not a reason to
                // stop listening; the script is just harder to follow.
            }

            // The engine's preferred format, and a converter from the
            // microphone's. The microphone is 48 kHz stereo on most Macs and
            // the models want 16 kHz mono.
            guard let target = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
                fail("FAILED", "The speech engine offered no audio format.")
                return
            }

            var converter: AVAudioConverter? = nil
            let opened: Bool = queue.sync {
                openMicrophone { buffer in
                    if converter == nil || converter!.inputFormat != buffer.format {
                        converter = AVAudioConverter(from: buffer.format, to: target)
                        // No priming: the first samples are worth less than the
                        // timestamp drift priming introduces, since the buffers
                        // carry no times of their own and are taken to be
                        // contiguous.
                        converter?.primeMethod = .none
                    }
                    guard let converter else { return }
                    let ratio = target.sampleRate / buffer.format.sampleRate
                    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
                    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }

                    var consumed = false
                    var error: NSError? = nil
                    converter.convert(to: out, error: &error) { _, status in
                        if consumed {
                            status.pointee = .noDataNow
                            return nil
                        }
                        consumed = true
                        status.pointee = .haveData
                        return buffer
                    }
                    if error == nil, out.frameLength > 0 {
                        continuation.yield(AnalyzerInput(buffer: out))
                    }
                }
            }
            guard opened else { return }

            teardown = {
                continuation.finish()
                await analyzer.cancelAndFinishNow()
            }

            emit(Update(stage: "listening"))

            // What has been finalised so far, kept so a partial can be
            // reported as the whole session's hypothesis: the follower aligns
            // the tail of it, and the tail may straddle a finalised segment
            // and the volatile one after it.
            var committed: [String] = []

            do {
                try await analyzer.start(inputSequence: stream)
                for try await result in transcriber.results {
                    let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    if result.isFinal {
                        if !text.isEmpty { committed.append(text) }
                        // Bounded: a long rehearsal must not grow every update.
                        // Only the tail is aligned, so dropping the head is free.
                        if committed.count > 12 { committed.removeFirst(committed.count - 12) }
                        emit(Update(stage: "final", text: committed.joined(separator: " "), session: session))
                    } else {
                        let whole = (committed + [text]).joined(separator: " ")
                        emit(Update(stage: "partial", text: whole, session: session))
                    }
                }
            } catch is CancellationError {
                return
            } catch {
                fail("FAILED", "Listening stopped: \(error.localizedDescription)")
            }
        }
    }

    // MARK: macOS 14–25: SFSpeechRecognizer

    private func startRecogniser() {
        SFSpeechRecognizer.requestAuthorization { [self] status in
            queue.async { [self] in
                guard status == .authorized else {
                    fail(
                        "NOT_AUTHORISED",
                        "Prequel needs permission to recognise speech. Grant it in System Settings under Privacy & Security."
                    )
                    return
                }

                guard let found = SFSpeechRecognizer(locale: Locale(identifier: locale))
                    ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
                else {
                    fail("NO_LOCAL_MODEL", "macOS has no speech recogniser for \(locale).")
                    return
                }

                // Never cleared for an unsupported locale: turning it off would
                // send the room to Apple's servers, live.
                guard found.supportsOnDeviceRecognition else {
                    fail(
                        "NO_LOCAL_MODEL",
                        "macOS has no on-device speech model for \(locale). Add the language in System Settings under Keyboard, Dictation."
                    )
                    return
                }

                recogniser = found
                guard openMicrophone(sink: { [weak self] buffer in self?.hear(buffer) }) else { return }
                emit(Update(stage: "listening"))
                beginRequest()
            }
        }
    }

    /// One request, from now until it is retired.
    private func beginRequest() {
        guard let recogniser else { return }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.taskHint = .dictation
        // Punctuation is stripped by the follower anyway, and asking for it
        // costs latency on every partial.
        request.addsPunctuation = false
        if !contextual.isEmpty { request.contextualStrings = contextual }

        generation += 1
        let mine = generation
        self.request = request
        requestStartedAt = Date()

        task = recogniser.recognitionTask(with: request) { [weak self] result, error in
            guard let strong = self else { return }
            strong.queue.async {
                // A retired request may still speak; only the live one is heard.
                guard mine == strong.generation else { return }

                if let result {
                    let text = result.bestTranscription.formattedString
                    strong.emit(Update(stage: result.isFinal ? "final" : "partial", text: text, session: strong.session))
                    if result.isFinal { strong.retireRequest() }
                    return
                }

                // An error ends a request. Most are the recogniser giving up
                // on a stretch of silence or reaching its ceiling, neither of
                // which is a reason to stop listening — so it starts again.
                if error != nil { strong.retireRequest() }
            }
        }
    }

    /// Ends the live request and begins another. The receiver sees a new session.
    private func retireRequest() {
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        session += 1
        beginRequest()
    }

    /// Feeds the live request, retiring it when it has run long enough.
    private func hear(_ buffer: AVAudioPCMBuffer) {
        guard let request else { return }
        request.append(buffer)

        let running = Date().timeIntervalSince(requestStartedAt)
        let quietFor = quietSince.map { Date().timeIntervalSince($0) } ?? 0
        if running >= REQUEST_HARD_LIMIT || (running >= REQUEST_SOFT_LIMIT && quietFor >= QUIET_SECONDS) {
            // `endAudio` makes the recogniser deliver its final result, and the
            // final is what begins the next request — so the words in flight
            // are not lost to the cut.
            request.endAudio()
        }
    }
}

// MARK: - Level

/// The buffer's loudness, 0–1, on the dock meter's dB scale.
private func meter(_ buffer: AVAudioPCMBuffer) -> Double {
    guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }

    var total = 0.0
    for frame in 0..<Int(buffer.frameLength) {
        let sample = Double(channel[frame])
        total += sample * sample
    }
    let rms = (total / Double(buffer.frameLength)).squareRoot()
    let db = 20 * log10(max(rms, 1e-6))
    return min(1, max(0, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)))
}
