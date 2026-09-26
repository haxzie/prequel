/**
 * The version gate and the one clock conversion.
 *
 * `onSessionClock` is the whole reason this file matters. Every session media
 * file is zero-based, so a word's place in the recording is its offset into
 * `mic.m4a` plus the microphone track's `start` — and applying that offset
 * twice, or not at all, puts every caption out by however late the microphone
 * happened to open. It is invisible on a machine where the microphone starts
 * promptly and obvious on one where it does not.
 */
import { describe, expect, it } from "vitest";

import {
  TRANSCRIPT_VERSION,
  TranscriptError,
  fromSeconds,
  onSessionClock,
  parseTranscript,
  untranscribed,
  type Transcript,
} from "./transcript.js";
import { MANIFEST_VERSION, type Manifest } from "./manifest.js";

const RECORDING = "rec-1";

/**
 * A stored transcript, written by the build that uploaded to OpenAI.
 *
 * Deliberately still that provider: transcription happens on the machine now,
 * but a recording captioned before the change has one of these beside it and
 * must keep opening. `parseTranscript` gates on the version, never the name.
 */
const transcript = (over: Partial<Transcript> = {}): string =>
  JSON.stringify({
    version: TRANSCRIPT_VERSION,
    recordingId: RECORDING,
    provider: "openai",
    model: "whisper-1",
    language: "en",
    timings: "native",
    words: [{ at: 0, end: 500_000_000, text: "hello", confidence: 0.99 }],
    ...over,
  });

describe("parseTranscript", () => {
  it("reads one this build wrote", () => {
    const parsed = parseTranscript(transcript(), RECORDING)!;

    expect(parsed.words).toHaveLength(1);
    expect(parsed.timings).toBe("native");
  });

  it("declines a version it does not know", () => {
    // Null, not a throw: the recording is still perfectly editable, it just has
    // no captions until it is transcribed again.
    expect(parseTranscript(transcript({ version: 99 }), RECORDING)).toBeNull();
  });

  it("declines one that belongs to a different recording", () => {
    // A directory copied, or a session restored from a backup. Applying it
    // would caption the footage with someone else's words.
    expect(parseTranscript(transcript(), "rec-2")).toBeNull();
  });

  it("declines a malformed word rather than dropping it", () => {
    // Half a transcript is worse than none: captions built from the remainder
    // would silently omit what was said, with nothing to show it happened.
    const missing = transcript({
      words: [
        { at: 0, end: 1, text: "hello", confidence: 1 },
        { at: 2, text: "world", confidence: 1 } as never,
      ],
    });

    expect(parseTranscript(missing, RECORDING)).toBeNull();
  });

  it("declines a word that ends before it starts", () => {
    const backwards = transcript({
      words: [{ at: 500, end: 100, text: "hello", confidence: 1 }],
    });

    expect(parseTranscript(backwards, RECORDING)).toBeNull();
  });

  it("sorts words a provider returned out of order", () => {
    const shuffled = transcript({
      words: [
        { at: 1_000, end: 2_000, text: "world", confidence: 1 },
        { at: 0, end: 900, text: "hello", confidence: 1 },
      ],
    });

    expect(parseTranscript(shuffled, RECORDING)!.words.map((w) => w.text)).toEqual([
      "hello",
      "world",
    ]);
  });

  it("throws only on JSON that is not JSON", () => {
    expect(() => parseTranscript("{oh dear", RECORDING)).toThrow(TranscriptError);
  });
});

describe("onSessionClock", () => {
  const words = [{ at: 0, end: fromSeconds(1), text: "hello", confidence: 1 }];

  it("shifts every word by the microphone's late start", () => {
    // The provider measured from the start of `mic.m4a`, which is zero-based.
    // Where that file sits in the session lives only in the manifest.
    const shifted = onSessionClock(words, { start: fromSeconds(0.75) });

    expect(shifted[0]!.at).toBe(fromSeconds(0.75));
    expect(shifted[0]!.end).toBe(fromSeconds(1.75));
  });

  it("leaves a track that started with the clock alone", () => {
    expect(onSessionClock(words, { start: 0 })[0]!.at).toBe(0);
  });

  it("treats a missing microphone track as no offset", () => {
    // A recording with no microphone has no transcript either, but the caller
    // should not have to prove that before asking.
    expect(onSessionClock(words, undefined)[0]!.at).toBe(0);
  });

  it("keeps each word's length", () => {
    const shifted = onSessionClock(words, { start: fromSeconds(2) });

    expect(shifted[0]!.end - shifted[0]!.at).toBe(fromSeconds(1));
  });
});

const S = 1_000_000_000;

/** A recording with a microphone, and a clip imported onto the end of it. */
function recording(): Manifest {
  return {
    version: MANIFEST_VERSION,
    id: RECORDING,
    started_at: "2026-09-25T10:00:00Z",
    duration: 14 * S,
    source: { kind: "display", id: 1, title: "Display", scale_factor: 2 },
    tracks: [
      {
        kind: "microphone",
        segments: [{ file_name: "mic.m4a", start: 0, end: 10 * S, samples: 0, dropped: 0 }],
      },
      {
        kind: "system_audio",
        segments: [
          { file_name: "2/screen.mp4", start: 10 * S, end: 14 * S, samples: 0, dropped: 0 },
        ],
      },
    ],
    takes: [
      { dir: "", start: 0, end: 10 * S },
      { dir: "2", start: 10 * S, end: 14 * S, imported: true },
    ],
  };
}

const parsed = (over: Partial<Transcript> = {}): Transcript =>
  parseTranscript(transcript(over), RECORDING)!;

describe("untranscribed", () => {
  it("is everything when nothing has been transcribed", () => {
    expect(untranscribed(recording(), null).map((segment) => segment.file_name)).toEqual([
      "mic.m4a",
      "2/screen.mp4",
    ]);
  });

  it("is nothing when everything has been", () => {
    const covered = parsed({ covered: ["mic.m4a", "2/screen.mp4"] });

    expect(untranscribed(recording(), covered)).toEqual([]);
  });

  it("is the imported clip when only the microphone was transcribed", () => {
    // The case this exists for: a recording captioned before the clip was
    // imported. The words already written are still right — appending never
    // moves a timestamp — so only the new footage is listened to.
    const covered = parsed({ covered: ["mic.m4a"] });

    expect(untranscribed(recording(), covered).map((segment) => segment.file_name)).toEqual([
      "2/screen.mp4",
    ]);
  });

  it("reads a transcript written before imports as having covered the microphone", () => {
    // No `covered` list at all, which is every transcript written before this.
    // Read as "covered nothing" it would transcribe the whole recording again
    // on the next open and hand back words it already had.
    expect(untranscribed(recording(), parsed()).map((segment) => segment.file_name)).toEqual([
      "2/screen.mp4",
    ]);
  });
});
