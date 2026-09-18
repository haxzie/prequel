/**
 * The follower is judged on behaviour, not on the alignment it computes.
 *
 * What matters to a reader: the highlight keeps up when they read, holds when
 * they riff, catches up when they skip, follows when they go back, and never
 * leaps somewhere they are not. Each test drives the follower the way a
 * recogniser would — a hypothesis that grows a word at a time, its last word
 * arriving half-said and then corrected — because a matcher that only works on
 * clean, whole words works nowhere.
 */
import { describe, expect, it } from "vitest";

import {
  INITIAL_FOLLOW,
  follow,
  fuzzy,
  jumpTo,
  normalise,
  skipDirections,
  stepSentences,
  tokenise,
  vocabulary,
  type FollowState,
  type ScriptWord,
} from "./teleprompter.js";

const SCRIPT = `Welcome to Prequel, a screen recorder for the Mac.
Today we are going to record a short demo of the new teleprompter.
[smile at the camera]
It sits in the notch, right under the lens, so your eyes stay on the camera.
Type your script, press record, and read.
The words light up as you say them, and nothing you see here ends up in the recording.
In 2026 we shipped 3 features like this one.
That's all for today. Thanks for watching!`;

/**
 * Feeds a spoken passage to the follower the way an engine would.
 *
 * Each word arrives twice: first as its opening letters — the engine emits a
 * partial mid-word — then whole. The hypothesis is the whole session so far.
 * Returns the state after the last update and every position along the way.
 */
function speak(
  words: ScriptWord[],
  state: FollowState,
  passage: string,
  session = state.session,
): { state: FollowState; positions: number[] } {
  const spoken = passage.split(/\s+/).filter(Boolean);
  const positions: number[] = [];
  const said: string[] = [];
  let current = state;

  for (const word of spoken) {
    if (word.length > 3) {
      current = follow(words, current, [...said, word.slice(0, 3)], session);
      positions.push(current.position);
    }
    said.push(word);
    current = follow(words, current, said, session);
    positions.push(current.position);
  }

  return { state: current, positions };
}

/** The script's spoken words from `from` up to, not including, `to`. */
function passage(words: ScriptWord[], from: number, to: number): string {
  return words
    .slice(from, to)
    .filter((word) => !word.direction)
    .map((word) => word.text)
    .join(" ");
}

const words = tokenise(SCRIPT);
const spoken = words.filter((word) => !word.direction);

describe("tokenise", () => {
  it("marks bracketed notes as directions across several words", () => {
    const note = words.filter((word) => word.direction).map((word) => word.text);
    expect(note).toEqual(["[smile", "at", "the", "camera]"]);
    expect(words.find((word) => word.text === "camera]")!.keys).toEqual([]);
  });

  it("starts a sentence after terminal punctuation and at every line", () => {
    const starts = words.filter((word) => word.sentenceStart).map((word) => word.text);
    expect(starts).toEqual(["Welcome", "Today", "It", "Type", "The", "In", "That's", "Thanks"]);
  });
});

describe("normalise", () => {
  it("drops punctuation and apostrophes but keeps the word whole", () => {
    expect(normalise("That's")).toEqual(["thats"]);
    expect(normalise("Prequel,")).toEqual(["prequel"]);
    expect(normalise("café")).toEqual(["cafe"]);
  });

  it("reads numbers aloud", () => {
    expect(normalise("2026")).toEqual(["two", "thousand", "twenty", "six"]);
    expect(normalise("1,000")).toEqual(["one", "thousand"]);
    expect(normalise("15")).toEqual(["fifteen"]);
    expect(normalise("100")).toEqual(["one", "hundred"]);
    // A phone number is said a digit at a time.
    expect(normalise("07700")).toEqual(["zero", "seven", "seven", "zero", "zero"]);
  });

  it("spells symbols the way they are said", () => {
    expect(normalise("50%")).toEqual(["fifty", "percent"]);
    expect(normalise("R&D")).toEqual(["r", "and", "d"]);
  });
});

describe("fuzzy", () => {
  it("forgives one edit in a short word and more in a long one", () => {
    expect(fuzzy("prequel", "prequal")).toBe(true);
    expect(fuzzy("teleprompter", "teleprompted")).toBe(true);
    expect(fuzzy("cat", "cut")).toBe(false);
  });

  it("accepts a partial cut mid-word", () => {
    expect(fuzzy("tele", "teleprompter")).toBe(true);
    expect(fuzzy("te", "teleprompter")).toBe(false);
  });
});

describe("follow", () => {
  it("keeps up with a verbatim read and never steps back", () => {
    const { state, positions } = speak(words, INITIAL_FOLLOW, passage(words, 0, words.length));

    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]!);
    }
    expect(state.position).toBe(words.length);
    expect(state.lost).toBe(false);
  });

  it("moves on the word just said, not the one after it", () => {
    // The whole of the prompter's felt lag. Once the reader is placed, each
    // expected word moves the highlight on the update that carries it — the
    // alignment alone needed the *next* word too, so it sat a word behind
    // the voice all the way down the script.
    const said: string[] = [];
    let state = INITIAL_FOLLOW;
    spoken.forEach((word, i) => {
      said.push(word.text);
      state = follow(words, state, said, 0);
      // The first word is the one exception: one word places nobody.
      if (i < 1) return;
      expect(state.position).toBe(skipDirections(words, word.index + 1));
    });
  });

  it("does not move on a stop word said out of turn", () => {
    // "the" is the next word of the script, and "the" is what a riff is made
    // of. Alone it must not count; after the word before it, it does.
    const at = words.findIndex((word, i) => i > 2 && word.keys[0] === "the");
    expect(at).toBeGreaterThan(0);
    const placed = { ...INITIAL_FOLLOW, position: at };
    expect(follow(words, placed, ["anyway", "so", "the"], 0).position).toBe(at);
    const before = words[at - 1]!.text;
    expect(follow(words, placed, ["anyway", before, "the"], 0).position).toBe(
      skipDirections(words, at + 1),
    );
  });

  it("stays within a word of the reader throughout", () => {
    // After each whole word, the position should be at most one word behind
    // where the reader is — the first word of a session is the one exception,
    // because a single word is not evidence of anything — and at most one
    // ahead, plus any direction it stepped over on the way.
    const said: string[] = [];
    let state = INITIAL_FOLLOW;
    spoken.forEach((word, i) => {
      said.push(word.text);
      state = follow(words, state, said, 0);
      if (i < 1) return;
      const readerAt = word.index + 1;
      expect(state.position).toBeGreaterThanOrEqual(readerAt - 1);
      expect(state.position).toBeLessThanOrEqual(skipDirections(words, readerAt + 1));
    });
  });

  it("holds while the reader riffs, and resumes where they come back", () => {
    const first = speak(words, INITIAL_FOLLOW, passage(words, 0, 12));
    const before = first.state.position;

    const riff = speak(
      words,
      first.state,
      "actually let me tell you a quick story about how this started on a rainy afternoon " +
        "when nothing worked and the coffee had run out entirely",
    );
    expect(riff.state.position).toBe(before);
    expect(riff.state.lost).toBe(true);

    const back = speak(words, riff.state, passage(words, 12, 20));
    expect(back.state.position).toBe(20);
    expect(back.state.lost).toBe(false);
  });

  it("catches up within a few words when the reader skips a line", () => {
    const first = speak(words, INITIAL_FOLLOW, passage(words, 0, 12));
    // Jump two lines on: from word 12 to the sentence starting "Type".
    const skipTo = words.find((word) => word.text === "Type")!.index;
    // Caught up by the third word at the latest.
    const early = speak(words, first.state, passage(words, skipTo, skipTo + 3));
    expect(early.state.position).toBeGreaterThanOrEqual(skipTo + 2);

    const { state } = speak(words, first.state, passage(words, skipTo, skipTo + 6));
    expect(state.position).toBe(skipTo + 6);
  });

  it("follows the reader back when they re-read a sentence", () => {
    const first = speak(words, INITIAL_FOLLOW, passage(words, 0, 24));
    const again = words.find((word) => word.text === "Today")!.index;

    const { state } = speak(words, first.state, passage(words, again, again + 6), 1);
    expect(state.position).toBe(again + 6);
  });

  it("is not dragged back by a repeated stop word", () => {
    const first = speak(words, INITIAL_FOLLOW, passage(words, 0, 30));
    const { state } = speak(words, first.state, "the the of the");
    expect(state.position).toBe(30);
  });

  it("skips a direction the moment the reader reaches it", () => {
    const note = words.findIndex((word) => word.direction);
    const { state } = speak(words, INITIAL_FOLLOW, passage(words, 0, note));
    expect(state.position).toBeGreaterThan(note + 3);
    expect(words[state.position - 1]!.direction).toBe(true);
  });

  it("matches numbers however they are written", () => {
    const at = words.find((word) => word.text === "In")!.index;
    const primed: FollowState = { ...INITIAL_FOLLOW, position: at };

    const digits = speak(words, primed, "In 2026 we shipped 3 features");
    expect(digits.state.position).toBe(at + 6);

    const spokenOut = speak(words, primed, "In two thousand twenty six we shipped three features");
    expect(spokenOut.state.position).toBe(at + 6);
  });

  it("does not regress when the engine starts a new session", () => {
    const first = speak(words, INITIAL_FOLLOW, passage(words, 0, 20));

    // A fresh session hands over an empty, then a one-word, hypothesis. The
    // empty one moves nothing; the one word is the expected word, so it
    // moves on by exactly that word and no further.
    let state = follow(words, first.state, [], 1);
    expect(state.position).toBe(20);
    state = follow(words, state, [words[20]!.text], 1);
    expect(state.position).toBe(21);

    const { state: after } = speak(words, state, passage(words, 20, 26), 1);
    expect(after.position).toBe(26);
  });

  it("ignores fillers", () => {
    const { state } = speak(words, INITIAL_FOLLOW, "Welcome um to uh Prequel, a screen recorder");
    expect(state.position).toBe(6);
  });

  it("never moves further than the window allows", () => {
    // A perfect read of the last line from the start of the script fits
    // nowhere within reach, so the position must hold rather than leap.
    const last = words.filter((word) => word.paragraph === 7).map((word) => word.text);
    const { state } = speak(words, INITIAL_FOLLOW, last.join(" "));
    expect(state.position).toBeLessThanOrEqual(INITIAL_FOLLOW.position + 40);
  });
});

describe("moving by hand", () => {
  it("steps by sentence and skips directions on landing", () => {
    const today = words.find((word) => word.text === "Today")!.index;
    expect(stepSentences(words, 0, 1)).toBe(today);

    // Stepping onto the line that starts with a direction lands past it.
    const it_ = words.find((word) => word.text === "It")!.index;
    expect(stepSentences(words, today, 1)).toBe(it_);

    expect(stepSentences(words, it_ + 3, -1)).toBe(today);
    expect(stepSentences(words, 0, -1)).toBe(0);
  });

  it("clamps a jump to the script", () => {
    expect(jumpTo(words, -5)).toBe(0);
    expect(jumpTo(words, 10_000)).toBe(words.length);
  });
});

describe("vocabulary", () => {
  it("offers the long words once each, without directions", () => {
    const list = vocabulary(words);
    expect(list).toContain("Prequel");
    expect(list).toContain("teleprompter");
    expect(list).not.toContain("smile");
    expect(new Set(list.map((word) => word.toLowerCase())).size).toBe(list.length);
  });
});
