/**
 * What a speech-to-text provider has to offer, and what it costs to swap one.
 *
 * An interface rather than a direct call into one provider because the two
 * things that differ between them both change the UI, not just the wire format:
 * how large a file they will take, and whether their word times are real. A
 * second provider is a new file next to this one.
 */
import type { Timings } from "../../shared/transcript.js";

/** One word, still on the provider's own clock: offsets into the audio it was given. */
export interface ProviderWord {
  /** Nanoseconds from the start of the audio. */
  at: number;
  end: number;
  text: string;
  /** 0–1. Providers that do not score words should report 1. */
  confidence: number;
}

export interface TranscribeResult {
  words: ProviderWord[];
  /** BCP-47, as the provider detected or was told. */
  language: string;
  model: string;
  timings: Timings;
}

export interface Transcriber {
  /** Shown in the editor and recorded in `transcript.json`. */
  readonly name: string;

  /**
   * The largest upload this provider accepts, in bytes.
   *
   * Carried rather than discovered from a failed request: a long take that is
   * going to be refused should be refused before it is uploaded, with a message
   * that says why. It is the tightest ceiling on the path, not the provider's
   * own — a serverless host in front of the provider is usually the narrowest
   * hop, and it answers 413 with nothing useful in it.
   */
  readonly maxBytes: number;

  /**
   * Whether this provider produces real per-word boundaries.
   *
   * `"interpolated"` means the times were derived from segment boundaries and
   * are commonly a few hundred milliseconds out — fine for subtitles, not for
   * word-by-word highlighting, which the editor hides rather than showing it
   * lighting the wrong word.
   */
  readonly timings: Timings;

  transcribe(audio: Uint8Array, signal: AbortSignal): Promise<TranscribeResult>;
}

/** Raised for anything the user can act on: no key, too long, nothing heard. */
export class TranscribeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TranscribeError";
    this.code = code;
  }
}
