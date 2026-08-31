import { describe, expect, it } from "vitest";

import { CAPTION_STYLES, captionStyle, cuesFrom } from "./captions";
import type { TranscriptWord } from "./transcript";

const SECOND = 1_000_000_000;

/** Words on a steady cadence, so a break can only come from a rule under test. */
function said(text: string, options: { from?: number; gap?: number } = {}): TranscriptWord[] {
  const gap = options.gap ?? 0;
  let at = options.from ?? 0;

  return text.split(" ").map((word) => {
    const start = at;
    // Half a second a word, which is about conversational speed.
    at += SECOND / 2 + gap;
    return { at: start, end: start + SECOND / 2, text: word, confidence: 1 };
  });
}

describe("captionStyle", () => {
  it("falls back rather than throwing on a look this build does not ship", () => {
    // A project written by a newer build must still open. A missing look is a
    // plainer video; a throw here is a recording that cannot be edited at all.
    expect(captionStyle("no-such-style").id).toBe("subtitle");
  });

  it("keeps every look that lights a word off the plated ones", () => {
    // The lit layer is a rectangle cropped out of a bitmap that carries the
    // plate, so growing it would drag the plate's own edge with it and show a
    // seam. `captionBitmap` relies on this holding.
    for (const style of CAPTION_STYLES) {
      if (style.plate && style.lit) expect(style.lit.pop).toBe(1);
    }
  });
});

describe("the styles that carry a plate", () => {
  it("gives every plated look the same dark", () => {
    // Subtitle, Highlight and Band are one family: the difference between them
    // is shape and whether a word lights, never the colour of the plate.
    const plated = CAPTION_STYLES.filter((style) => style.plate).map((style) => style.plate!.color);

    expect(new Set(plated).size).toBe(1);
  });

  it("plates the two looks a caption panel opens on", () => {
    // Highlight is the default, and it read as having no background at all
    // while a stale bitmap from an older build was still on disk. Both of the
    // pill styles carry one.
    for (const id of ["subtitle", "highlight"]) {
      expect(captionStyle(id).plate).not.toBeNull();
    }
  });
});

describe("cuesFrom", () => {
  it("keeps a phrase together", () => {
    const cues = cuesFrom(said("one two three"), { lines: 2 });

    expect(cues).toHaveLength(1);
    expect(cues[0]!.lines).toEqual(["one two three"]);
  });

  it("breaks on a silence", () => {
    // A gap is a breath, and a caption that runs across one reads as lagging.
    const first = said("before the pause");
    const second = said("and after it", { from: 10 * SECOND });

    expect(cuesFrom([...first, ...second], { lines: 2 })).toHaveLength(2);
  });

  it("breaks after a full stop", () => {
    const cues = cuesFrom(said("done. next one"), { lines: 2 });

    expect(cues).toHaveLength(2);
    expect(cues[0]!.lines).toEqual(["done."]);
  });

  it("breaks a long line onto the next one before starting a new cue", () => {
    const cues = cuesFrom(said("alpha bravo charlie delta echo foxtrot golf"), { lines: 2 });

    // Two lines' worth of words is one cue, not two.
    expect(cues[0]!.lines.length).toBeGreaterThan(1);
  });

  it("starts a new cue once the last line is full", () => {
    const words = said("alpha bravo charlie delta echo foxtrot golf hotel india juliet");
    const one = cuesFrom(words, { lines: 1 });
    const two = cuesFrom(words, { lines: 2 });

    // The same words, so a tighter line budget can only mean more cues.
    expect(one.length).toBeGreaterThan(two.length);
    for (const cue of one) expect(cue.lines).toHaveLength(1);
  });

  it("never holds a cue past the next one", () => {
    // Cues are held towards their successor so captions do not blink out in
    // every pause. Two on screen at once is the failure that would cause.
    const cues = cuesFrom(said("one. two. three. four."), { lines: 2 });

    expect(cues.length).toBeGreaterThan(1);
    for (let index = 0; index < cues.length - 1; index += 1) {
      expect(cues[index]!.end).toBeLessThanOrEqual(cues[index + 1]!.at);
    }
  });

  it("gives every cue a span it is actually on screen for", () => {
    for (const cue of cuesFrom(said("a longer run of words to group up"), { lines: 2 })) {
      expect(cue.end).toBeGreaterThan(cue.at);
    }
  });

  it("puts every word on a line the cue has", () => {
    // A word pointing at a line that was never laid out has no box, so the
    // highlight would light nothing — or worse, the wrong place.
    for (const cue of cuesFrom(said("alpha bravo charlie delta echo foxtrot golf"), { lines: 2 })) {
      for (const word of cue.words) {
        expect(cue.lines[word.line]).toBeDefined();
        expect(cue.lines[word.line]).toContain(word.text);
      }
    }
  });

  it("keeps words in order and inside their cue", () => {
    const cues = cuesFrom(said("one two three. four five six"), { lines: 2 });

    for (const cue of cues) {
      let last = -1;
      for (const word of cue.words) {
        expect(word.at).toBeGreaterThanOrEqual(last);
        expect(word.at).toBeGreaterThanOrEqual(cue.at);
        expect(word.end).toBeLessThanOrEqual(cue.end);
        last = word.at;
      }
    }
  });

  it("drops empty words rather than laying out a blank", () => {
    const words: TranscriptWord[] = [
      { at: 0, end: SECOND, text: "  ", confidence: 1 },
      { at: SECOND, end: 2 * SECOND, text: "real", confidence: 1 },
    ];

    expect(cuesFrom(words, { lines: 2 })[0]!.lines).toEqual(["real"]);
  });

  it("leaves out the sounds that are not words", () => {
    // Both engines transcribe verbatim, so a take opening "Uh, we..." captions
    // as that unless these are dropped.
    const words: TranscriptWord[] = [
      { at: 0, end: SECOND, text: "Uh,", confidence: 0.13 },
      { at: SECOND, end: 2 * SECOND, text: "um", confidence: 0.4 },
      { at: 2 * SECOND, end: 3 * SECOND, text: "right", confidence: 0.9 },
    ];

    expect(cuesFrom(words, { lines: 2 })[0]!.lines).toEqual(["right"]);
  });

  it("keeps real words the engine was unsure of", () => {
    // The reason fillers are matched by token and not by a confidence floor:
    // what an engine scores lowest is quiet real speech, and dropping that
    // silently removes what somebody said.
    const words: TranscriptWord[] = [
      { at: 0, end: SECOND, text: "murmured", confidence: 0.08 },
      { at: SECOND, end: 2 * SECOND, text: "words", confidence: 0.12 },
    ];

    expect(cuesFrom(words, { lines: 2 })[0]!.lines).toEqual(["murmured words"]);
  });

  it("has nothing to say about a recording with no words", () => {
    expect(cuesFrom([], { lines: 2 })).toEqual([]);
  });
});
