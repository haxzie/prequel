/**
 * The subtitle track, and the grouping under it.
 *
 * The rules are the desktop's, so the cases are the ones its own suite pins:
 * a breath breaks a cue, a full stop ends the cue it belongs to, a long run
 * is cut before it reads as frozen, and a cue is held towards the next one
 * but never over it.
 */
import { describe, expect, it } from "vitest";

import { cuesFrom, languageTag, vttFrom, vttTimestamp } from "../src/lib/captions.ts";
import type { TranscriptWord } from "../src/lib/chapters.ts";

/** `text` said one word per `pace`; a word ending in `|` is followed by a breath. */
function said(text: string, pace = 1_000): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let at = 0;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const breath = token.endsWith("|");
    const clean = breath ? token.slice(0, -1) : token;
    words.push({ at, end: at + Math.round(pace * 0.6), text: clean });
    at += breath ? 2_000 : pace;
  }
  return words;
}

const texts = (cues: ReturnType<typeof cuesFrom>) => cues.map((cue) => cue.lines.join(" / "));

describe("cuesFrom", () => {
  it("breaks at a breath and at the end of a sentence", () => {
    const cues = cuesFrom(said("one two| three four. five six"));
    expect(texts(cues)).toEqual(["one two", "three four.", "five six"]);
  });

  it("holds a cue towards the next, never over it", () => {
    const cues = cuesFrom(said("one two| three"));
    // "two" ends at 1.6 s; held 400 ms to 2.0 s, and "three" starts at 3.0 s.
    expect(cues[0]?.end).toBe(2_000);
    // Nothing follows the last cue, so it gets its full hold.
    expect(cues[1]?.end).toBe(3_000 + 600 + 400);

    const tight = cuesFrom(said("one two. three"));
    // "three" starts at 2.0 s, before the hold would end: the cue stops there.
    expect(tight[0]?.end).toBe(2_000);
  });

  it("cuts a run before it reads as frozen", () => {
    const cues = cuesFrom(said("a b c d e f g h i j k l"));
    for (const cue of cues) expect(cue.end - cue.at).toBeLessThanOrEqual(5_000 + 400);
    expect(cues.length).toBeGreaterThan(1);
  });

  it("wraps onto a second line, then a new cue", () => {
    // Said quickly, so the line fills before the time limit cuts the cue.
    const long = Array.from({ length: 14 }, (_, i) => `word${i}`).join(" ");
    const cues = cuesFrom(said(long, 250));
    expect(cues[0]?.lines).toHaveLength(2);
    for (const cue of cues)
      for (const line of cue.lines) expect(line.length).toBeLessThanOrEqual(42);
  });

  it("drops filler sounds", () => {
    // Quickly, so dropping "uh" does not leave a breath's worth of silence
    // where it was — that would break the cue, correctly, for another reason.
    expect(texts(cuesFrom(said("um so uh yes", 300)))).toEqual(["so yes"]);
  });

  it("gives a word whose end was cut away a moment on screen", () => {
    const cues = cuesFrom([{ at: 1_000, end: 1_000, text: "cut" }]);
    expect(cues[0]?.end).toBeGreaterThan(1_000);
  });
});

describe("vttFrom", () => {
  it("writes timestamps the way every parser reads them", () => {
    expect(vttTimestamp(0)).toBe("00:00:00.000");
    expect(vttTimestamp(61_005)).toBe("00:01:01.005");
    expect(vttTimestamp(3_600_000 + 1)).toBe("01:00:00.001");
  });

  it("is a WebVTT file with one block per cue", () => {
    const vtt = vttFrom({ language: "en", words: said("Hello there.| A <b> & B") });
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:02.000 line:-3\nHello there.");
    // What was said is never markup.
    expect(vtt).toContain("A &lt;b&gt; &amp; B");
  });
});

describe("languageTag", () => {
  it("turns Whisper's names into tags and leaves tags alone", () => {
    expect(languageTag("german")).toBe("de");
    expect(languageTag("English")).toBe("en");
    expect(languageTag("en-GB")).toBe("en-gb");
    expect(languageTag("pt-BR")).toBe("pt-br");
    // Unknown, and kept rather than guessed.
    expect(languageTag("klingon")).toBe("klingon");
  });
});
