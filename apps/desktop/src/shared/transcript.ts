/**
 * What was said, and when.
 *
 * Its own file beside `session.json` rather than a field inside it. A
 * transcript is derived — it can be regenerated, discarded, or produced by a
 * different provider tomorrow — and `MANIFEST_VERSION` gates whether a
 * recording can be opened at all. Tying the two together would mean a
 * transcript format change locking users out of their footage.
 *
 * Deliberately free of any `electron` or Node import: main writes it, the
 * renderer receives it over IPC, and both need the same types.
 */
import type { MediaTime, Track } from "./manifest.js";

/**
 * Bumped whenever the shape changes incompatibly.
 *
 * A mismatch is discarded and offered for re-transcription rather than thrown,
 * which is the one place this differs from `parseManifest`: an unreadable
 * manifest means the recording cannot be edited, and an unreadable transcript
 * means it has no captions yet.
 */
export const TRANSCRIPT_VERSION = 1;

export const TRANSCRIPT_FILE_NAME = "transcript.json";

/** How the provider arrived at its word times. */
export type Timings =
  /** Per-word boundaries the model actually produced. */
  | "native"
  /**
   * Interpolated from segment boundaries — commonly 200–500ms out per word,
   * which at conversational speed is most of a word.
   *
   * Carried so the editor can decline to offer word-by-word highlighting on a
   * transcript that cannot support it, rather than lighting the wrong word.
   */
  | "interpolated";

export interface TranscriptWord {
  /**
   * Source time on the session clock — the provider's offset into `mic.m4a`
   * plus the microphone track's `start`.
   *
   * Every session media file is zero-based, so the microphone's late start
   * exists only in the manifest. This is the one conversion, and doing it a
   * second time — by subtracting a probed file start as well — is the mistake
   * that puts every caption a few hundred milliseconds out.
   */
  at: MediaTime;
  end: MediaTime;
  text: string;
  /** 0–1, as the provider scored it. */
  confidence: number;
}

export interface Transcript {
  version: number;
  /**
   * The manifest's `id`.
   *
   * A transcript sitting beside a different recording — a directory copied, a
   * session restored from a backup — is worth catching. Applying it would
   * caption the footage with someone else's words.
   */
  recordingId: string;
  provider: string;
  model: string;
  /** BCP-47, as the provider reported it. */
  language: string;
  timings: Timings;
  words: TranscriptWord[];
}

export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptError";
  }
}

/**
 * Reads a transcript, or null if it is not one this build can use.
 *
 * Null rather than a throw for every recoverable case, because all of them have
 * the same answer: there are no captions yet, and the editor offers to make
 * some. Only malformed JSON throws, since that means something wrote the file
 * badly rather than wrote it differently.
 */
export function parseTranscript(text: string, recordingId: string): Transcript | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new TranscriptError(`${TRANSCRIPT_FILE_NAME} is not valid JSON: ${String(cause)}`);
  }

  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Partial<Transcript>;

  if (value.version !== TRANSCRIPT_VERSION) return null;
  if (value.recordingId !== recordingId) return null;
  if (!Array.isArray(value.words)) return null;

  const words = value.words.filter(isWord);
  // A transcript whose words did not survive the filter is not half-usable:
  // captions built from the remainder would silently omit what was said.
  if (words.length !== value.words.length) return null;

  return {
    version: TRANSCRIPT_VERSION,
    recordingId,
    provider: typeof value.provider === "string" ? value.provider : "unknown",
    model: typeof value.model === "string" ? value.model : "unknown",
    language: typeof value.language === "string" ? value.language : "en",
    timings: value.timings === "interpolated" ? "interpolated" : "native",
    // Sorted rather than trusted. Grouping and the per-frame lookup both walk
    // these in order, and a provider that returns one word out of place would
    // show up as a caption that flickers rather than as bad data.
    words: [...words].sort((a, b) => a.at - b.at),
  };
}

function isWord(value: unknown): value is TranscriptWord {
  if (typeof value !== "object" || value === null) return false;
  const word = value as Partial<TranscriptWord>;

  return (
    typeof word.at === "number" &&
    Number.isFinite(word.at) &&
    typeof word.end === "number" &&
    Number.isFinite(word.end) &&
    word.end >= word.at &&
    typeof word.text === "string" &&
    typeof word.confidence === "number"
  );
}

/**
 * Moves a provider's offsets into `mic.m4a` onto the session clock.
 *
 * The single place the microphone's late start is applied. Everything
 * downstream — grouping, the timeline, the plan — works in source time, so
 * nothing after this needs to know the manifest had an offset in it at all.
 */
export function onSessionClock(
  words: readonly { at: MediaTime; end: MediaTime; text: string; confidence: number }[],
  mic: Pick<Track, "start"> | undefined,
): TranscriptWord[] {
  const offset = mic?.start ?? 0;

  return words.map((word) => ({
    at: word.at + offset,
    end: word.end + offset,
    text: word.text,
    confidence: word.confidence,
  }));
}

/** Seconds, as every provider reports them, to nanoseconds on the session clock. */
export function fromSeconds(seconds: number): MediaTime {
  return Math.round(seconds * 1_000_000_000);
}
