// The only Swift in this tree, and it is here because there is no alternative.
//
// `SpeechAnalyzer`/`SpeechTranscriber` — the engine that matters, and the only
// one without a length ceiling — has no Objective-C face at all. cidre 0.20
// does carry native Swift-ABI bindings for it, but they expose neither file
// input nor timestamps, so there is nothing to hand-roll `msg_send!` against
// the way `prequel-render/src/image.rs` does for CGImageSource.
//
// Two engines, picked by what the OS has:
//
//   macOS 26+   SpeechAnalyzer + SpeechTranscriber. Fed the whole file. Needs
//               no Speech authorisation at all — measured, not assumed — and
//               reports a time range and a confidence per *word*.
//   macOS 14-25 SFSpeechRecognizer with `requiresOnDeviceRecognition`, fed
//               PCM buffers and cut into chunks at the quietest moment near
//               each boundary.
//
// Results cross to Rust as one JSON string, which is the representation both
// sides already agree on — the same reason the render plan crosses that way.
// A callback per word would be five C function pointers and a lifetime
// question for every string.
import AVFoundation
import Foundation
import Speech

// MARK: - The wire

private struct Word: Encodable {
    let at: Double
    let end: Double
    let text: String
    let confidence: Double
}

private struct Success: Encodable {
    let ok = true
    let language: String
    let model: String
    /// `native` when the engine measured each word, `interpolated` when it did not.
    let timings: String
    let words: [Word]
}

private struct Failure: Encodable {
    let ok = false
    /// One of the codes `apple.ts` turns into something a user can act on.
    let code: String
    let message: String
}

private func encode<T: Encodable>(_ value: T) -> UnsafeMutablePointer<CChar> {
    let data = (try? JSONEncoder().encode(value)) ?? Data("{\"ok\":false,\"code\":\"FAILED\",\"message\":\"could not encode the result\"}".utf8)
    return strdup(String(decoding: data, as: UTF8.self))!
}

private func fail(_ code: String, _ message: String) -> UnsafeMutablePointer<CChar> {
    encode(Failure(code: code, message: message))
}

// MARK: - Entry points

/// Frees a string handed back by this module. Every returned pointer is `strdup`ed.
@_cdecl("prequel_speech_free")
public func prequel_speech_free(_ text: UnsafeMutablePointer<CChar>?) {
    if let text { free(text) }
}

/// What this machine can do, as JSON. Never fails.
@_cdecl("prequel_speech_probe")
public func prequel_speech_probe(_ locale: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar> {
    let identifier = locale.map { String(cString: $0) } ?? "en-US"
    var analyzer = false

    if #available(macOS 26.0, *) {
        analyzer = SpeechTranscriber.isAvailable
    }

    // Constructing a recogniser is safe without authorisation; only *asking*
    // for authorisation trips TCC, and that is deliberately not done here — a
    // probe must never put a permission dialog on screen.
    let recogniser = SFSpeechRecognizer(locale: Locale(identifier: identifier))

    let payload: [String: Any] = [
        "analyzer": analyzer,
        "recogniser": recogniser?.supportsOnDeviceRecognition ?? false,
        "locale": identifier,
    ]

    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
    return strdup(String(decoding: data, as: UTF8.self))!
}

/// Transcribes a file, blocking until it is done. Returns JSON the caller frees.
@_cdecl("prequel_speech_transcribe")
public func prequel_speech_transcribe(
    _ path: UnsafePointer<CChar>,
    _ locale: UnsafePointer<CChar>,
    _ ctx: UnsafeMutableRawPointer?,
    _ onProgress: @convention(c) (UnsafeMutableRawPointer?, Double) -> Void,
    _ cancelled: @convention(c) (UnsafeMutableRawPointer?) -> Int32
) -> UnsafeMutablePointer<CChar> {
    let url = URL(fileURLWithPath: String(cString: path))
    let identifier = String(cString: locale)

    let report = Reporter(ctx: ctx, onProgress: onProgress, cancelled: cancelled)

    // The async engines are driven from a blocking call because the caller is a
    // worker thread in Rust with no run loop and no executor of its own. A
    // semaphore is the whole bridge.
    let gate = DispatchSemaphore(value: 0)
    nonisolated(unsafe) var answer: UnsafeMutablePointer<CChar> = fail("FAILED", "nothing ran")

    Task {
        if #available(macOS 26.0, *), SpeechTranscriber.isAvailable {
            answer = await analyse(url: url, locale: identifier, report: report)
        } else {
            answer = await recognise(url: url, locale: identifier, report: report)
        }
        gate.signal()
    }

    gate.wait()
    return answer
}

// MARK: - Progress

/// Carries the Rust callbacks, and knows how long the file is so it can divide.
private final class Reporter: @unchecked Sendable {
    private let ctx: UnsafeMutableRawPointer?
    private let onProgress: @convention(c) (UnsafeMutableRawPointer?, Double) -> Void
    private let isCancelled: @convention(c) (UnsafeMutableRawPointer?) -> Int32

    /// Seconds of audio, once known. Progress before that is indeterminate.
    var duration: Double = 0

    init(
        ctx: UnsafeMutableRawPointer?,
        onProgress: @escaping @convention(c) (UnsafeMutableRawPointer?, Double) -> Void,
        cancelled: @escaping @convention(c) (UnsafeMutableRawPointer?) -> Int32
    ) {
        self.ctx = ctx
        self.onProgress = onProgress
        self.isCancelled = cancelled
    }

    var cancelled: Bool { isCancelled(ctx) != 0 }

    /// Reports how far through the *audio* the engine has reached.
    func reached(_ seconds: Double) {
        guard duration > 0 else { return }
        onProgress(ctx, min(1, max(0, seconds / duration)))
    }
}

// MARK: - macOS 26: SpeechAnalyzer

@available(macOS 26.0, *)
private func analyse(url: URL, locale identifier: String, report: Reporter) async -> UnsafeMutablePointer<CChar> {
    let wanted = Locale(identifier: identifier)

    // Two awaits rather than a `??` chain: the right-hand side of `??` is an
    // autoclosure, which cannot be async.
    var resolved = await SpeechTranscriber.supportedLocale(equivalentTo: wanted)
    if resolved == nil {
        resolved = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US"))
    }

    guard let supported = resolved else {
        return fail("NO_LOCAL_MODEL", "macOS has no on-device speech model for \(identifier).")
    }

    let transcriber = SpeechTranscriber(
        locale: supported,
        transcriptionOptions: [],
        reportingOptions: [],
        // Word-granularity, both of them — measured, not assumed: every run
        // that comes back is one word with its own range and score.
        attributeOptions: [.audioTimeRange, .transcriptionConfidence]
    )

    do {
        // A first run on a machine that has never transcribed downloads a
        // model. Reported as indeterminate progress rather than a stall.
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }

        let file = try AVAudioFile(forReading: url)
        report.duration = Double(file.length) / file.processingFormat.sampleRate

        let analyzer = SpeechAnalyzer(modules: [transcriber])

        nonisolated(unsafe) var words: [Word] = []
        let collecting: Task<Void, Error> = Task {
            for try await result in transcriber.results {
                let text = result.text
                for run in text.runs {
                    guard let range = run.audioTimeRange else { continue }
                    let piece = String(text[run.range].characters)
                        .trimmingCharacters(in: .whitespaces)
                    if piece.isEmpty { continue }

                    words.append(Word(
                        at: range.start.seconds,
                        end: range.end.seconds,
                        text: piece,
                        // Unscored words are reported as certain rather than as
                        // zero: the editor dims low confidence, and a missing
                        // score is not the same as a bad one.
                        confidence: run.transcriptionConfidence ?? 1
                    ))
                }
                report.reached(result.range.end.seconds)
            }
        }

        _ = try await analyzer.analyzeSequence(from: file)
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        try await collecting.value

        if report.cancelled { return fail("CANCELLED", "Cancelled.") }
        if words.isEmpty {
            return fail("NO_SPEECH", "No speech was heard in this recording's microphone track.")
        }

        return encode(Success(
            language: supported.identifier(.bcp47),
            model: "SpeechTranscriber",
            timings: "native",
            words: words
        ))
    } catch {
        return fail("FAILED", "Transcription failed: \(error.localizedDescription)")
    }
}

// MARK: - macOS 14-25: SFSpeechRecognizer

/// How much audio goes into one recognition request, in seconds.
private let CHUNK_SECONDS = 40.0

/// How far back from the end of a chunk to hunt for a quiet moment to cut at.
private let CHUNK_TAIL_SECONDS = 8.0

/// The window the loudness is measured over when hunting for that moment.
private let RMS_WINDOW_SECONDS = 0.1

private func recognise(url: URL, locale identifier: String, report: Reporter) async -> UnsafeMutablePointer<CChar> {
    let status = await withCheckedContinuation { (resume: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
        SFSpeechRecognizer.requestAuthorization { resume.resume(returning: $0) }
    }

    guard status == .authorized else {
        return fail(
            "NOT_AUTHORISED",
            "Prequel needs permission to recognise speech. Grant it in System Settings under Privacy & Security."
        )
    }

    guard let recogniser = SFSpeechRecognizer(locale: Locale(identifier: identifier))
        ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    else {
        return fail("NO_LOCAL_MODEL", "macOS has no speech recogniser for \(identifier).")
    }

    // Never cleared to rescue an unsupported locale. Turning it off would send
    // the microphone track to Apple's servers, which is the exact thing doing
    // this on the machine exists to avoid.
    guard recogniser.supportsOnDeviceRecognition else {
        return fail(
            "NO_LOCAL_MODEL",
            "macOS has no on-device speech model for \(identifier). Add the language in System Settings under Keyboard, Dictation."
        )
    }

    do {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let rate = format.sampleRate
        report.duration = Double(file.length) / rate

        var words: [Word] = []
        var offset = 0.0

        while file.framePosition < file.length {
            if report.cancelled { return fail("CANCELLED", "Cancelled.") }

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.requiresOnDeviceRecognition = true
            request.addsPunctuation = true
            // Only the final result is used, so partials are pure overhead —
            // and a partial arriving after `isFinal` would resume the
            // continuation twice.
            request.shouldReportPartialResults = false

            let seconds = try feed(request, from: file, format: format)
            request.endAudio()
            if seconds <= 0 { break }

            let transcription = await run(recogniser, request)
            // A chunk that recognised nothing is silence, not a failure. The
            // clock still advances, so the next chunk lands where it should.
            for segment in transcription?.segments ?? [] {
                let text = segment.substring.trimmingCharacters(in: .whitespaces)
                if text.isEmpty { continue }
                words.append(Word(
                    at: offset + segment.timestamp,
                    end: offset + segment.timestamp + segment.duration,
                    text: text,
                    confidence: Double(segment.confidence)
                ))
            }

            offset += seconds
            report.reached(offset)
        }

        if words.isEmpty {
            return fail("NO_SPEECH", "No speech was heard in this recording's microphone track.")
        }

        return encode(Success(
            language: recogniser.locale.identifier(.bcp47),
            model: "SFSpeechRecognizer",
            // Measured per utterance by the recogniser rather than interpolated
            // from a segment span, so the editor may light a word with them.
            timings: "native",
            words: words
        ))
    } catch {
        return fail("FAILED", "Transcription failed: \(error.localizedDescription)")
    }
}

/**
 Appends one chunk of audio, cutting at the quietest moment near the boundary.

 Cutting on a fixed count would land mid-word once a minute, and the word either
 side of the cut is then heard as two half-words. Tracking loudness while
 reading costs one pass over samples that are being read anyway, and needs no
 silence detector — the quietest 100ms in the last eight seconds is a breath
 often enough to be worth preferring to an arbitrary boundary.

 Returns the seconds appended, which is what the next chunk's offset advances by.
 */
private func feed(
    _ request: SFSpeechAudioBufferRecognitionRequest,
    from file: AVAudioFile,
    format: AVAudioFormat
) throws -> Double {
    let rate = format.sampleRate
    let window = AVAudioFrameCount(RMS_WINDOW_SECONDS * rate)
    let target = AVAudioFrameCount(CHUNK_SECONDS * rate)
    let tail = AVAudioFrameCount(CHUNK_TAIL_SECONDS * rate)

    var appended: AVAudioFrameCount = 0
    // The quietest window seen inside the tail, and where the file was when it
    // ended — which is where the next chunk resumes.
    var quietest = Double.infinity
    var cutAt: AVAudioFramePosition? = nil

    while appended < target && file.framePosition < file.length {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: window) else { break }
        try file.read(into: buffer)
        if buffer.frameLength == 0 { break }

        request.append(buffer)
        appended += buffer.frameLength

        if appended + tail >= target {
            let level = rms(buffer)
            if level < quietest {
                quietest = level
                cutAt = file.framePosition
            }
        }
    }

    // Resume the next chunk at the quiet moment rather than where reading
    // stopped, so nothing is dropped and nothing is heard twice.
    if let cutAt, cutAt < file.framePosition {
        appended -= AVAudioFrameCount(file.framePosition - cutAt)
        file.framePosition = cutAt
    }

    return Double(appended) / rate
}

/// Mean square of the first channel. Not rooted — only the ordering is used.
private func rms(_ buffer: AVAudioPCMBuffer) -> Double {
    guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }

    var total = 0.0
    for frame in 0..<Int(buffer.frameLength) {
        let sample = Double(channel[frame])
        total += sample * sample
    }
    return total / Double(buffer.frameLength)
}

/// Runs one request to its final result, or nil if it produced none.
private func run(
    _ recogniser: SFSpeechRecognizer,
    _ request: SFSpeechAudioBufferRecognitionRequest
) async -> SFTranscription? {
    await withCheckedContinuation { resume in
        // A recognition task calls back more than once and can report an error
        // *after* a final result. Resuming a continuation twice is a crash, so
        // the first answer wins and the rest are dropped.
        nonisolated(unsafe) var answered = false

        recogniser.recognitionTask(with: request) { result, error in
            if answered { return }

            if let result, result.isFinal {
                answered = true
                resume.resume(returning: result.bestTranscription)
                return
            }

            if error != nil {
                answered = true
                resume.resume(returning: nil)
            }
        }
    }
}
