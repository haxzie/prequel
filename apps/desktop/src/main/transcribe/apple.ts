/**
 * macOS, on this machine.
 *
 * The audio never leaves the Mac. Two Apple engines sit behind the addon call —
 * `SpeechAnalyzer` on macOS 26 and up, `SFSpeechRecognizer` below it — and
 * which one ran shows up only as the model name on the transcript.
 *
 * This replaced an upload to OpenAI's `whisper-1` through our own Worker, and
 * the reasons are not only cost. `whisper-1` interpolates word times from
 * segment boundaries, so every transcript came back `interpolated` and the
 * editor declined to light a word with it; both Apple engines measure each word
 * and report a confidence for it. The 25 MB ceiling is gone with the upload,
 * and so is the rate limit an anonymous install was counted against.
 *
 * Reached through `main/recorder.ts` rather than `@prequel/recorder` directly,
 * like everything else native, so a test can hand `setRecorder` a fake.
 */
import type { TranscribeUpdate } from "../recorder.js";
import { getRecorder } from "../recorder.js";
import { TranscribeError, type ProviderWord, type TranscribeResult } from "./transcriber.js";

/** Seconds, as both engines report them, to nanoseconds. */
const NS = 1_000_000_000;

/** One word as the addon relays it: seconds into the audio it was given. */
interface NativeWord {
  at: number;
  end: number;
  text: string;
  confidence: number;
}

/**
 * The language to transcribe in.
 *
 * The system's, because there is no language setting and the person who made
 * the recording is overwhelmingly likely to have been speaking the language
 * their Mac is set to. The engine resolves it to the nearest variant it has a
 * model for, and reports back what it actually used.
 */
function systemLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
}

export function apple(): {
  name: string;
  available(): Promise<boolean>;
  transcribe(
    path: string,
    signal: AbortSignal,
    onProgress: (stage: "preparing" | "transcribing", progress: number | null) => void,
  ): Promise<TranscribeResult>;
} {
  return {
    name: "apple",

    async available(): Promise<boolean> {
      const recorder = await getRecorder();
      const status = recorder.speechAvailability(systemLocale());
      return status.analyzer || status.recogniser;
    },

    async transcribe(path, signal, onProgress): Promise<TranscribeResult> {
      const recorder = await getRecorder();
      const locale = systemLocale();

      return new Promise<TranscribeResult>((resolve, reject) => {
        // Guards against a late update after the promise has settled. Both
        // engines can report an error behind a terminal stage, and settling a
        // promise twice is silent — the second result simply vanishes.
        let settled = false;

        const stop = () => {
          if (settled) return;
          recorder.cancelTranscribe();
        };
        signal.addEventListener("abort", stop, { once: true });

        const done = (finish: () => void) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", stop);
          finish();
        };

        try {
          recorder.startTranscribe({ audio: path, locale }, (error, update) => {
            if (error) {
              done(() => reject(new TranscribeError("FAILED", error.message)));
              return;
            }

            switch (update.stage) {
              case "preparing":
              case "transcribing":
                onProgress(update.stage, update.progress ?? null);
                return;

              case "done":
                done(() => resolve(assemble(update)));
                return;

              case "cancelled":
                // Rejected with the abort, so the job runner takes its normal
                // cancelled path rather than treating this as a failure.
                done(() => reject(signal.reason ?? new Error("cancelled")));
                return;

              case "failed":
                done(() =>
                  reject(
                    new TranscribeError(
                      update.code ?? "FAILED",
                      update.message ?? "Captions could not be generated.",
                    ),
                  ),
                );
                return;
            }
          });
        } catch (cause) {
          // `startTranscribe` throws synchronously when one is already running.
          done(() => reject(cause));
        }
      });
    },
  };
}

function assemble(update: TranscribeUpdate): TranscribeResult {
  let native: NativeWord[];
  try {
    native = JSON.parse(update.words ?? "[]") as NativeWord[];
  } catch (cause) {
    throw new TranscribeError("FAILED", `Could not read the transcript: ${String(cause)}`);
  }

  if (native.length === 0) {
    throw new TranscribeError(
      "NO_SPEECH",
      "No speech was heard in this recording's microphone track.",
    );
  }

  return {
    words: native.map(toWord),
    language: update.language ?? "en",
    model: update.model ?? "SpeechTranscriber",
    // Taken from the engine rather than assumed: the two differ in principle,
    // and the editor declines to light a word on an interpolated transcript.
    timings: update.timings === "interpolated" ? "interpolated" : "native",
  };
}

function toWord(word: NativeWord): ProviderWord {
  return {
    // Still on the audio's own clock. The microphone's late start is applied
    // once, by `onSessionClock`, and applying it here as well is the mistake
    // that puts every caption a few hundred milliseconds out.
    at: Math.round(word.at * NS),
    end: Math.round(word.end * NS),
    text: word.text,
    confidence: word.confidence,
  };
}
