/**
 * OpenAI, reached through the Prequel route on the marketing site.
 *
 * The audio goes to our server and our server forwards it to OpenAI. That is a
 * deliberate difference from a token-minting arrangement, and it is forced:
 * OpenAI's ephemeral keys are scoped to the Realtime API, so there is no way to
 * hand this machine a short-lived credential for `/v1/audio/transcriptions`.
 * The alternative would be shipping the real key inside the app, which is not
 * an alternative at all.
 *
 * `mic.m4a` is uploaded as-is. OpenAI accepts AAC in an MP4 container, so there
 * is nothing to transcode — which matters, because ffmpeg is a test dependency
 * here and deliberately not a runtime one.
 */
import {
  TranscribeError,
  type ProviderWord,
  type TranscribeResult,
  type Transcriber,
} from "./transcriber.js";

/**
 * The largest upload to attempt, in bytes.
 *
 * Checked here so a long take is refused before it is sent, with a message that
 * says why, rather than arriving as a 413 from whichever hop is narrowest.
 *
 * Two ceilings stack. OpenAI accepts 25 MB, and a serverless host in front of
 * it typically accepts far less — Vercel's function body limit is 4.5 MB and
 * cannot be raised from application code. At the 128 kbps `mic.m4a` is written
 * at, 4 MB is a little over four minutes of speech.
 *
 * Set to the tighter of the two on purpose. Being told a recording is too long
 * is a bad outcome; uploading for a minute and *then* being told is a worse
 * one.
 */
const MAX_BYTES = 4 * 1024 * 1024;

/** Where the site forwards a transcription to OpenAI. */
const TRANSCRIBE_PATH = "/api/transcribe";

/** One word as the route relays it: nanoseconds, already converted server-side. */
interface RelayedWord {
  at: number;
  end: number;
  text: string;
  confidence: number;
}

export function openai(baseUrl: () => string, installId: () => string): Transcriber {
  return {
    name: "openai",
    maxBytes: MAX_BYTES,
    // `whisper-1` is the only OpenAI model that returns word timestamps at all —
    // the gpt-4o transcribe models do not expose `timestamp_granularities` — and
    // the times it does return are interpolated from segment boundaries rather
    // than measured. Declared honestly so the editor can decline to offer
    // word-by-word highlighting instead of lighting the wrong word.
    timings: "interpolated",

    async transcribe(audio: Uint8Array, signal: AbortSignal): Promise<TranscribeResult> {
      const body = new FormData();
      // Named so the route can hand it straight on: OpenAI infers the container
      // from the extension, and an unnamed blob is rejected as an unknown format.
      // Copied into a plain `ArrayBuffer` first. `readFile` hands back a Node
      // `Buffer` over a possibly-shared pool, and `BlobPart` will not take a
      // view onto one — a `Blob` built from a pooled buffer can also capture
      // bytes either side of the file.
      const bytes = new Uint8Array(audio).slice().buffer;
      body.append("audio", new Blob([bytes], { type: "audio/mp4" }), "mic.m4a");

      const response = await fetch(new URL(TRANSCRIBE_PATH, baseUrl()), {
        method: "POST",
        headers: { "x-prequel-install": installId() },
        body,
        signal,
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new TranscribeError(
          `TRANSCRIBE_${response.status}`,
          detail?.message ?? `Transcription failed (${response.status}).`,
        );
      }

      const result = (await response.json()) as {
        words?: RelayedWord[];
        language?: string;
        model?: string;
      };

      const words = result.words ?? [];
      if (words.length === 0) {
        throw new TranscribeError(
          "NO_SPEECH",
          "No speech was heard in this recording's microphone track.",
        );
      }

      return {
        words: words.map(toWord),
        language: result.language ?? "en",
        model: result.model ?? "whisper-1",
        timings: "interpolated",
      };
    },
  };
}

function toWord(word: RelayedWord): ProviderWord {
  return {
    at: word.at,
    end: word.end,
    text: word.text,
    confidence: word.confidence,
  };
}
