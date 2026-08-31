/**
 * What a speech-to-text provider has to offer, and what it costs to swap one.
 *
 * An interface rather than a direct call into one engine, because the thing
 * that differs between them is visible in the UI: whether the machine can do it
 * at all. A second provider is a new file next to this one.
 *
 * It used to carry `maxBytes` and `timings` as well. Both went when the upload
 * did: nothing has a size ceiling now that the audio stays on the machine, and
 * two engines sit behind the one provider with different answers about word
 * times — so `timings` belongs on the result, which is where it already was.
 */
import type { Timings } from "../../shared/transcript.js";

/** One word, still on the audio's own clock: offsets into the file it was given. */
export interface ProviderWord {
  /** Nanoseconds from the start of the audio. */
  at: number;
  end: number;
  text: string;
  /** 0-1. Providers that do not score words should report 1. */
  confidence: number;
}

export interface TranscribeResult {
  words: ProviderWord[];
  /** BCP-47, as the provider detected or was told. */
  language: string;
  model: string;
  /**
   * How this provider arrived at its word times.
   *
   * On the result rather than the provider because it is a property of the
   * engine that actually ran, and one provider may have more than one.
   * `"interpolated"` means the editor declines word-by-word highlighting rather
   * than showing it lighting the wrong word.
   */
  timings: Timings;
}

export interface Transcriber {
  /** Shown in the editor and recorded in `transcript.json`. */
  readonly name: string;

  /**
   * Whether this machine can transcribe at all.
   *
   * Asked before a run rather than discovered from a failed one, and it must
   * never prompt: a recording in a language macOS has no model for should be
   * told so by a disabled button, not by a permission dialog followed by an
   * error.
   */
  available(): Promise<boolean>;

  /**
   * Transcribes a file.
   *
   * A path rather than the bytes: the engine is native code that opens the file
   * itself, and reading a half-hour take into the main process only to hand it
   * straight back would be the peak memory of the whole app for nothing.
   */
  transcribe(
    path: string,
    signal: AbortSignal,
    onProgress: (stage: "preparing" | "transcribing", progress: number | null) => void,
  ): Promise<TranscribeResult>;
}

/** Raised for anything the user can act on: no model, no permission, nothing heard. */
export class TranscribeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TranscribeError";
    this.code = code;
  }
}
