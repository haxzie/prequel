import { describe, expect, it } from "vitest";

import type { Transcript } from "../../../shared/transcript";
import { transcriptForShare } from "./shareTranscript";
import { place } from "./timeline";

const S = 1_000_000_000;

function spoken(text: string): Transcript {
  return {
    version: 1,
    recordingId: "rec",
    provider: "test",
    model: "test",
    language: "en",
    timings: "native",
    words: text.split(" ").map((word, index) => ({
      at: index * S,
      end: index * S + 0.8 * S,
      text: word,
      confidence: 1,
    })),
  };
}

describe("transcriptForShare", () => {
  it("is null with no transcript", () => {
    expect(
      transcriptForShare(null, place([{ id: "a", source: { start: 0, end: S }, speed: 1 }])),
    ).toBeNull();
  });

  it("converts to milliseconds into the file", () => {
    const shared = transcriptForShare(
      spoken("one two three"),
      place([{ id: "a", source: { start: 0, end: 3 * S }, speed: 1 }]),
    );

    expect(shared).toEqual({
      language: "en",
      words: [
        { at: 0, end: 800, text: "one" },
        { at: 1000, end: 1800, text: "two" },
        { at: 2000, end: 2800, text: "three" },
      ],
    });
  });

  it("drops the words in cut-out footage and closes the gap", () => {
    // "two" and "three" begin in the cut. "four" begins at 3 s in the source,
    // which is 1 s into the file once the cut is closed.
    const shared = transcriptForShare(
      spoken("one two three four five"),
      place([
        { id: "a", source: { start: 0, end: 1 * S }, speed: 1 },
        { id: "b", source: { start: 3 * S, end: 5 * S }, speed: 1 },
      ]),
    );

    expect(shared?.words.map((word) => [word.text, word.at])).toEqual([
      ["one", 0],
      ["four", 1000],
      ["five", 2000],
    ]);
  });

  it("ends a word at the cut when its end was cut away", () => {
    const shared = transcriptForShare(
      spoken("one two"),
      // The clip ends half a second into "one", before the word does.
      place([{ id: "a", source: { start: 0, end: 0.5 * S }, speed: 1 }]),
    );

    expect(shared?.words).toEqual([{ at: 0, end: 500, text: "one" }]);
  });

  it("never lets a word span a cut", () => {
    // "one" is 0–0.8 s. The first clip ends at 0.5 s and the second starts at
    // 0.6 s, so the word's end survives — 0.6 s of source is 0.5 s of file —
    // but in the next clip. It still ends where its own clip does.
    const shared = transcriptForShare(
      spoken("one two"),
      place([
        { id: "a", source: { start: 0, end: 0.5 * S }, speed: 1 },
        { id: "b", source: { start: 0.6 * S, end: 2 * S }, speed: 1 },
      ]),
    );

    expect(shared?.words[0]).toEqual({ at: 0, end: 500, text: "one" });
  });

  it("is null when nothing was said in what survived", () => {
    const shared = transcriptForShare(
      spoken("one two"),
      place([{ id: "a", source: { start: 5 * S, end: 6 * S }, speed: 1 }]),
    );

    expect(shared).toBeNull();
  });
});
