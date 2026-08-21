/**
 * A deterministic stand-in for a speech-to-text provider.
 *
 * Paired with `PREQUEL_FAKE_RECORDER=1`, which already drives the whole UI with
 * no Screen Recording grant. Without this the captions half of the editor would
 * be the one part of the app that could not be exercised without a network, a
 * key and a real recording — which is exactly the part with the most UI in it.
 *
 * The words are spread across the fake recording rather than bunched at zero,
 * and their gaps are uneven, so the grouping, the timeline lane and the
 * word-by-word highlight all have something real to do.
 */
import type { ProviderWord, TranscribeResult, Transcriber } from "./transcriber.js";

const SENTENCE = [
  "Here",
  "is",
  "what",
  "a",
  "caption",
  "looks",
  "like",
  "when",
  "every",
  "word",
  "lands",
  "on",
  "its",
  "own",
  "beat.",
  "The",
  "highlight",
  "follows",
  "the",
  "voice,",
  "one",
  "word",
  "at",
  "a",
  "time.",
];

/** How long the fake transcript covers, in nanoseconds. */
const SPAN = 20_000_000_000;

export function fakeTranscriber(): Transcriber {
  return {
    name: "fake",
    // Nothing is uploaded, so nothing is too large. Kept finite rather than
    // Infinity so the size check upstream is still a real comparison here.
    maxBytes: Number.MAX_SAFE_INTEGER,
    timings: "native",

    transcribe(_audio: Uint8Array, signal: AbortSignal): Promise<TranscribeResult> {
      return new Promise((resolve, reject) => {
        // A beat of delay, so Cancel has something to cancel and the editor's
        // in-progress state is reachable by hand.
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve({ words: words(), language: "en", model: "fake-1", timings: "native" });
        }, 1_200);

        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason as Error);
        };

        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

function words(): ProviderWord[] {
  const step = SPAN / SENTENCE.length;

  return SENTENCE.map((text, index) => {
    const at = Math.round(index * step);
    // Spoken for most of the beat, with the remainder as the gap after it. The
    // gap is what the lit layer draws nothing across, so a fake with none would
    // never exercise that path.
    const end = Math.round(at + step * 0.75);

    return { at, end, text, confidence: 0.99 };
  });
}
