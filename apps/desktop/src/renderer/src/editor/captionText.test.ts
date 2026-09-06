/**
 * Typing over a transcript, without losing the time in it.
 *
 * The property that matters: a word the user did not touch keeps exactly the
 * time the recogniser gave it. Everything else — where typed words land, what
 * a deletion leaves behind — follows from the words either side, and the
 * tests here say what the words either side are and check where the new ones
 * went, rather than pinning the arithmetic.
 */
import { describe, expect, it } from "vitest";

import type { TranscriptWord } from "../../../shared/transcript";
import { mergeWords, realignWords, survivingWords, tokens, wordsWithin } from "./captionText";
import { place } from "./timeline";

const S = 1_000_000_000;

/** Words spoken one a second, back to back, from `text`. */
function spoken(text: string, from = 0): TranscriptWord[] {
  return tokens(text).map((word, index) => ({
    at: from + index * S,
    end: from + (index + 1) * S,
    text: word,
    confidence: 0.9,
  }));
}

const texts = (words: readonly TranscriptWord[]) => words.map((word) => word.text);

/** The invariants every realignment has to keep, whatever was typed. */
function wellFormed(words: readonly TranscriptWord[], text: string) {
  expect(texts(words)).toEqual(tokens(text));
  for (const [index, word] of words.entries()) {
    expect(word.end).toBeGreaterThanOrEqual(word.at);
    if (index > 0) expect(word.at).toBeGreaterThanOrEqual(words[index - 1]!.at);
  }
}

describe("tokens", () => {
  it("splits on any whitespace and keeps punctuation on its word", () => {
    expect(tokens("  Hello,\n world.  ")).toEqual(["Hello,", "world."]);
  });
});

describe("realignWords", () => {
  it("hands back the very same words when only whitespace changed", () => {
    // Identity is the signal the caller uses to skip recording an edit, so a
    // stray space must not count as one.
    const words = spoken("the quick brown fox");
    expect(realignWords(words, "the  quick\nbrown fox ")).toBe(words);
  });

  it("keeps every other word's time when one is retyped", () => {
    const words = spoken("the quick brown fox");
    const next = realignWords(words, "the quack brown fox");

    wellFormed(next, "the quack brown fox");
    expect(next[0]).toBe(words[0]);
    expect(next[2]).toBe(words[2]);
    expect(next[3]).toBe(words[3]);
    // The retyped word is spoken when the old one was.
    expect(next[1]).toMatchObject({ at: S, end: 2 * S, text: "quack" });
  });

  it("leaves a gap where a word was deleted", () => {
    const words = spoken("the quick brown fox");
    const next = realignWords(words, "the brown fox");

    wellFormed(next, "the brown fox");
    expect(next.map((word) => [word.at, word.end])).toEqual([
      [0, S],
      [2 * S, 3 * S],
      [3 * S, 4 * S],
    ]);
  });

  it("fits several typed words inside the one they replace, longest first", () => {
    const words = spoken("the quick brown fox");
    const next = realignWords(words, "the very extraordinarily fast brown fox");

    wellFormed(next, "the very extraordinarily fast brown fox");
    const typed = next.slice(1, 4);
    expect(typed[0]!.at).toBe(S);
    expect(typed[2]!.end).toBe(2 * S);
    // Contiguous, so the highlight never goes dark between them.
    expect(typed[1]!.at).toBe(typed[0]!.end);
    expect(typed[2]!.at).toBe(typed[1]!.end);
    // "extraordinarily" lights for longer than "very".
    expect(typed[1]!.end - typed[1]!.at).toBeGreaterThan(typed[0]!.end - typed[0]!.at);
  });

  it("joins the time of two words that were merged into one", () => {
    const words = spoken("the qui ck fox");
    const next = realignWords(words, "the quick fox");

    wellFormed(next, "the quick fox");
    expect(next[1]).toMatchObject({ at: S, end: 3 * S });
  });

  it("puts an inserted word into the silence between its neighbours", () => {
    const words = [...spoken("the quick"), ...spoken("fox", 5 * S)];
    const next = realignWords(words, "the quick brown fox");

    wellFormed(next, "the quick brown fox");
    expect(next[2]).toMatchObject({ at: 2 * S, end: 5 * S, text: "brown" });
    expect(next[1]).toBe(words[1]);
    expect(next[3]).toBe(words[2]);
  });

  it("borrows the tail of the word before when there is no silence", () => {
    const words = spoken("the quick fox");
    const next = realignWords(words, "the quick brown fox");

    wellFormed(next, "the quick brown fox");
    // The word before ends earlier and starts where it did.
    expect(next[1]!.at).toBe(S);
    expect(next[1]!.end).toBeLessThan(2 * S);
    expect(next[2]).toMatchObject({ at: next[1]!.end, end: 2 * S, text: "brown" });
    // The word after is untouched.
    expect(next[3]).toBe(words[2]);
  });

  it("takes the head of the first word when typed in front of it", () => {
    const words = spoken("quick fox");
    const next = realignWords(words, "the quick fox");

    wellFormed(next, "the quick fox");
    expect(next[0]).toMatchObject({ at: 0, text: "the" });
    expect(next[1]!.at).toBe(next[0]!.end);
    expect(next[1]!.end).toBe(S);
    expect(next[2]).toBe(words[1]);
  });

  it("uses the silence before the first word when there is some", () => {
    const words = spoken("quick fox", 3 * S);
    const next = realignWords(words, "the quick fox");

    expect(next[0]).toMatchObject({ at: 0, end: 3 * S, text: "the" });
    expect(next[1]).toBe(words[0]);
  });

  it("appends after the last word by borrowing its tail", () => {
    const words = spoken("the fox");
    const next = realignWords(words, "the fox jumps");

    wellFormed(next, "the fox jumps");
    expect(next[2]!.end).toBe(2 * S);
    expect(next[1]!.at).toBe(S);
  });

  it("types into an empty transcript without a time to measure against", () => {
    const next = realignWords([], "hello there");
    wellFormed(next, "hello there");
  });

  it("gives a typed word full confidence", () => {
    const next = realignWords(spoken("the fox"), "the fix");
    expect(next[1]!.confidence).toBe(1);
  });

  it("stays well formed across a long take and many edits", () => {
    // Keeps the prefix and suffix trimming honest too: without it every one of
    // these edits aligns five thousand words against five thousand.
    const long = Array.from({ length: 5000 }, (_, index) => `w${index}`).join(" ");
    let words = spoken(long);
    let text = long;

    const edits: ((tokens: string[]) => string[])[] = [
      (list) => list.map((token, index) => (index === 2500 ? "changed" : token)),
      (list) => [...list.slice(0, 100), ...list.slice(103)],
      (list) => [...list.slice(0, 4000), "a", "few", "more", ...list.slice(4000)],
      (list) => ["first", ...list],
      (list) => [...list, "last"],
      (list) => list.slice(10),
      (list) => [...list.slice(0, 300), "para graph pasted here", ...list.slice(700)],
    ];

    for (const edit of edits) {
      text = edit(tokens(text)).join(" ");
      words = realignWords(words, text);
      wellFormed(words, text);
    }
  });

  it("aligns a pasted paragraph too large to diff across the span it replaced", () => {
    const words = spoken(Array.from({ length: 600 }, (_, index) => `w${index}`).join(" "));
    const pasted = Array.from({ length: 600 }, (_, index) => `p${index}`).join(" ");
    const next = realignWords(words, pasted);

    wellFormed(next, pasted);
    expect(next[0]!.at).toBe(0);
    expect(next.at(-1)!.end).toBe(600 * S);
  });
});

describe("survivingWords", () => {
  const words = spoken("one two three four five");

  it("hides a word whose start was cut away, and keeps every word somewhere", () => {
    const placed = place([
      { id: "a", source: { start: 0, end: 1.5 * S } },
      { id: "b", source: { start: 3.5 * S, end: 5 * S } },
    ]);
    const { visible, hidden } = survivingWords(words, placed);

    // "two" begins at 1 s, inside the first clip, and still plays. "three" and
    // "four" begin in the cut between them.
    expect(texts(visible)).toEqual(["one", "two", "five"]);
    expect(texts(hidden)).toEqual(["three", "four"]);
    expect(visible.length + hidden.length).toBe(words.length);
  });

  it("gives a word beginning exactly on a cut to the later clip", () => {
    const placed = place([
      { id: "a", source: { start: 0, end: S } },
      { id: "b", source: { start: 2 * S, end: 5 * S } },
    ]);
    const { visible } = survivingWords(words, placed);

    // "two" starts at 1 s, on the cut, and its footage is gone. "three" starts
    // at 2 s where clip b begins, and plays.
    expect(texts(visible)).toEqual(["one", "three", "four", "five"]);
  });
});

describe("wordsWithin", () => {
  const words = spoken("one two three four five");

  it("keeps the words spoken during a clip and sets the others aside", () => {
    // The editor is scoped to what is selected, and everything it leaves out
    // still has to survive an edit.
    const { shown, rest } = wordsWithin(words, { start: S, end: 3 * S });

    expect(texts(shown)).toEqual(["two", "three"]);
    expect(texts(rest)).toEqual(["one", "four", "five"]);
  });

  it("gives a word starting on a boundary to the clip that plays it", () => {
    // Half-open, the way a slice's own range is: "three" begins at 2 s, which
    // is where the second clip starts.
    expect(texts(wordsWithin(words, { start: 0, end: 2 * S }).shown)).toEqual(["one", "two"]);
    expect(texts(wordsWithin(words, { start: 2 * S, end: 4 * S }).shown)).toEqual([
      "three",
      "four",
    ]);
  });

  it("shows the whole take when nothing is selected", () => {
    const { shown, rest } = wordsWithin(words, null);

    expect(shown).toEqual([...words]);
    expect(rest).toEqual([]);
  });
});

describe("mergeWords", () => {
  it("puts the hidden words back in time order among the edited ones", () => {
    const all = spoken("one two three four");
    const merged = mergeWords([all[1]!, all[2]!], [all[0]!, { ...all[3]!, text: "for" }]);

    expect(texts(merged)).toEqual(["one", "two", "three", "for"]);
  });
});
