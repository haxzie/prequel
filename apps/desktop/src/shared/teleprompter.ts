/**
 * Following a script by ear.
 *
 * The recogniser hands over a running hypothesis — the words it thinks it has
 * heard so far in the current session — and this decides where in the script
 * the reader has got to. Pure, so it can be tested without a microphone, and
 * shared, because main owns the position (the keys are global shortcuts, and
 * the recogniser calls back into main) while the island draws it.
 *
 * The design is an alignment, not a pointer that steps forward on each match.
 * A pointer has to decide what to do with every word it does not expect —
 * skip the script, skip the speech, or stop — and every choice is wrong some
 * of the time. Aligning the last few heard words against a window of the
 * script instead asks a better question: where does what was just said fit
 * best? Riffing off-script fits nowhere, so the position holds. Skipping a
 * line fits further on, so it catches up. Re-reading a sentence fits earlier,
 * so it follows back — but only on strong evidence, because "the the" must not
 * drag it back a line.
 */

/** One word of the script, as displayed and as matched. */
export interface ScriptWord {
  index: number;
  /** As written, for the island to draw. */
  text: string;
  /**
   * What it sounds like, for matching. Usually one entry; a number expands to
   * several ("2026" → two thousand twenty six), and a stage direction to none.
   */
  keys: string[];
  /**
   * Inside `[square brackets]`: a note to the reader, never spoken. Drawn dim,
   * skipped by the follower and counted as read the moment it is reached.
   */
  direction: boolean;
  /** Zero-based line of the script, so the island can break where the writer did. */
  paragraph: number;
  /** Starts a sentence, which is what the step keys move by. */
  sentenceStart: boolean;
}

/** Where the reader is, and how sure the follower is of it. */
export interface FollowState {
  /** Index of the next word to be read. Everything before it is read. */
  position: number;
  /**
   * The recogniser session the hypothesis belongs to.
   *
   * Every session starts with an empty hypothesis, so a new number means the
   * words that arrive next are not a continuation of the last ones. Without
   * it the first word of a fresh session looks like the transcript shrinking.
   */
  session: number;
  /**
   * Updates in a row that brought new words and matched nothing.
   *
   * Counted in updates rather than seconds so a test can drive it, and only
   * when the hypothesis grew, so a recogniser re-sending the same text while
   * the reader breathes does not run the count up.
   */
  missed: number;
  /** Enough misses that the reader is plainly off the script. */
  lost: boolean;
  /** How many words the session's hypothesis held last time, to tell growth from revision. */
  heard: number;
}

export const INITIAL_FOLLOW: FollowState = {
  position: 0,
  session: 0,
  missed: 0,
  lost: false,
  heard: 0,
};

/** How many recent heard words are aligned. */
const TAIL = 8;

/**
 * How far back of the position the script window reaches, in words.
 *
 * Far enough to re-read the previous sentence, which is the common reason to
 * go back: a fluffed line is read again from its start, not from the word
 * that went wrong.
 */
const BEHIND = 30;

/** How far ahead. A skipped line or two, not a skipped page. */
const AHEAD = 40;

/** Misses before the follower admits it has lost the reader. */
const LOST_AFTER = 5;

/**
 * Alignment scores.
 *
 * A stop word is worth half a real one: "of the" matches somewhere in any
 * fifty words of English, and two of them must not be enough to move the
 * position on their own. Fuzzy matches are worth the same as a stop word for
 * the same reason.
 */
const MATCH = 2;
const WEAK = 1;
const MISMATCH = -1;
const GAP = -1;

/**
 * Score a new position has to reach.
 *
 * Near the current position two real words are enough. A skip ahead needs
 * more, and a move back needs the most, plus three consecutive matches at the
 * end, because a backward move on thin evidence is what makes a prompter
 * visibly wrong — the highlight jumps up while the reader carries on.
 */
const ACCEPT_NEAR = 3;
const ACCEPT_AHEAD = 5;
const ACCEPT_BACK = 6;
const BACK_RUN = 3;

/** Within this many words of the position counts as staying put. */
const NEAR = 2;

const STOP_WORDS = new Set(
  "the a an of to and in is it that this for on with as at be or by we you i so if".split(" "),
);

/** Heard but never written: the recogniser transcribes hesitation as words. */
const FILLERS = new Set(["um", "uh", "erm", "hmm", "mm", "ah", "er"]);

// MARK: - Tokenising

/**
 * Splits a script into words the follower can match.
 *
 * Every newline is a paragraph. Writers put one thought per line in a script,
 * and a blank-line rule would join the lines they separated on purpose.
 */
export function tokenise(text: string): ScriptWord[] {
  const words: ScriptWord[] = [];
  let sentenceStart = true;

  text.split(/\r?\n/).forEach((line, paragraph) => {
    let direction = false;

    for (const raw of line.split(/\s+/)) {
      if (raw === "") continue;

      // Brackets can span words — "[pause here]" — so the flag carries across
      // tokens and is cleared by the closing one.
      const opens = raw.startsWith("[");
      const closes = raw.endsWith("]");
      const isDirection = direction || opens;
      if (opens) direction = true;
      if (closes) direction = false;

      words.push({
        index: words.length,
        text: raw,
        keys: isDirection ? [] : normalise(raw),
        direction: isDirection,
        paragraph,
        // A direction does not start a sentence: "[smile] Hello" starts at
        // Hello, which is where a step key should land.
        sentenceStart: !isDirection && sentenceStart,
      });

      if (!isDirection) sentenceStart = /[.!?]["')\]]*$/.test(raw);
    }

    // A line break ends a sentence whatever the punctuation. Script lines are
    // written as beats, and a step that ran across one would skip a beat.
    sentenceStart = true;
  });

  return words;
}

/**
 * What a word sounds like, as a list of keys.
 *
 * Applied to the script and the hypothesis alike, so the rule only has to be
 * consistent, not right. Digits become words because the engines return "2026"
 * for something said as words, and the script may have either.
 */
export function normalise(word: string): string[] {
  const flat = word
    .normalize("NFKD")
    // Combining marks, so "café" and "cafe" are one key.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/%/g, " percent ")
    .replace(/\+/g, " plus ")
    // Apostrophes vanish rather than split: "don't" is one word, "dont", on
    // both sides.
    .replace(/['’]/g, "")
    // Thousands separators, so "1,000" is one number.
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (flat === "") return [];

  const keys: string[] = [];
  for (const piece of flat.split(" ")) {
    if (/^\d+$/.test(piece)) keys.push(...numberWords(piece));
    else if (piece !== "") keys.push(piece);
  }
  return keys;
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * A run of digits as it would be read aloud.
 *
 * Up to 9999 the way a number is said; longer runs — phone numbers, ids — one
 * digit at a time, which is how they are said too. Years are said "twenty
 * twenty-six" as often as "two thousand and twenty-six", and the engines spell
 * both as "2026", so the script's form and the heard form meet here whichever
 * way it was read.
 */
function numberWords(digits: string): string[] {
  const value = Number(digits);
  if (digits.length > 4) return [...digits].map((d) => ONES[Number(d)]!);
  if (value < 20) return [ONES[value]!];

  const words: string[] = [];
  const thousands = Math.floor(value / 1000);
  const hundreds = Math.floor((value % 1000) / 100);
  const rest = value % 100;

  if (thousands) words.push(ONES[thousands]!, "thousand");
  if (hundreds) words.push(ONES[hundreds]!, "hundred");
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]!);
    if (rest % 10) words.push(ONES[rest % 10]!);
  } else if (rest > 0 || words.length === 0) {
    words.push(ONES[rest]!);
  }
  return words;
}

// MARK: - Matching

/**
 * Whether two keys are close enough to be the same word misheard.
 *
 * Thresholds scale with length: one edit in a short word is a different word
 * ("cat" / "cut"), one edit in a long one is an accent. The prefix rule is for
 * a partial result cut mid-word, which the engines do constantly.
 */
export function fuzzy(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  // "cat" and "cut" are one edit apart and are not the same word.
  if (shorter < 4) return false;

  const distance = editDistance(a, b);
  if (shorter <= 5) return distance <= 1;
  if (shorter <= 9) return distance <= 2;
  return distance <= Math.floor(Math.max(a.length, b.length) / 3);
}

/** Optimal string alignment distance: edits, with a transposition as one. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = new Array<number>(rows * cols).fill(0);
  for (let i = 0; i < rows; i += 1) d[i * cols] = i;
  for (let j = 0; j < cols; j += 1) d[j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[(i - 1) * cols + j]! + 1,
        d[i * cols + j - 1]! + 1,
        d[(i - 1) * cols + j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[(i - 2) * cols + j - 2]! + 1);
      }
      d[i * cols + j] = best;
    }
  }
  return d[rows * cols - 1]!;
}

/** What one heard key is worth against one script key. */
function score(heard: string, written: string): number {
  if (heard === written) return STOP_WORDS.has(written) ? WEAK : MATCH;
  if (!STOP_WORDS.has(written) && fuzzy(heard, written)) return WEAK;
  return MISMATCH;
}

/** A script key laid out for alignment, remembering which word it came from. */
interface Cell {
  word: number;
  key: string;
}

/**
 * The words the recogniser has heard, as keys, ready to align.
 *
 * Only the tail: the earlier words were aligned by earlier updates, and a
 * hypothesis grows for the life of a session. Fillers are dropped rather than
 * scored, because "um" costs a gap otherwise, and readers say it a lot.
 */
function heardKeys(hypothesis: readonly string[]): string[] {
  const keys: string[] = [];
  for (const word of hypothesis) {
    for (const key of normalise(word)) {
      if (!FILLERS.has(key)) keys.push(key);
    }
  }
  return keys.slice(-TAIL);
}

/** The script keys within reach of the position. */
function window(words: readonly ScriptWord[], position: number): Cell[] {
  const cells: Cell[] = [];
  const from = Math.max(0, position - BEHIND);
  const to = Math.min(words.length, position + AHEAD);
  for (let index = from; index < to; index += 1) {
    for (const key of words[index]!.keys) cells.push({ word: index, key });
  }
  return cells;
}

/**
 * Advances the position past any directions sitting on it.
 *
 * They are never spoken, so the follower would wait forever for a word that
 * is not coming. Counted as read the moment the reader reaches them.
 */
export function skipDirections(words: readonly ScriptWord[], position: number): number {
  let at = position;
  while (at < words.length && words[at]!.direction) at += 1;
  return at;
}

/**
 * Where the reader is, given what has just been heard.
 *
 * `hypothesis` is the whole running transcript of the current session, as the
 * engine reports it; only its tail is used. `final` says the engine has
 * settled on it — a partial one has a last word that may still change, which
 * is why a move back by a word or two costs no more than a move forward by one.
 */
export function follow(
  words: readonly ScriptWord[],
  state: FollowState,
  hypothesis: readonly string[],
  session: number,
): FollowState {
  const heard = heardKeys(hypothesis);
  // A fresh session, or the same session with more in it. Anything else is the
  // engine re-sending or revising, which says nothing new about being lost.
  const grew = session !== state.session || hypothesis.length > state.heard;
  const next: FollowState = { ...state, session, heard: hypothesis.length };

  if (heard.length === 0 || state.position >= words.length) return next;

  const cells = window(words, state.position);
  const found = align(heard, cells);
  const accepted = found !== null && acceptable(found, state.position);

  if (!accepted) {
    if (grew) next.missed = state.missed + 1;
    next.lost = next.missed >= LOST_AFTER;
    return next;
  }

  next.position = skipDirections(words, found.word + 1);
  next.missed = 0;
  next.lost = false;
  return next;
}

/** The best alignment of the heard tail against the window, or null. */
interface Alignment {
  /** Script word the last aligned heard word matched. */
  word: number;
  score: number;
  /** Consecutive matches ending the alignment. */
  run: number;
}

/**
 * Smith–Waterman over a few dozen cells.
 *
 * Local alignment, so the heard tail may start matching anywhere in the
 * window and the words before that are free — those are the ones an earlier
 * update already placed, or a riff that has just ended. The alignment has to
 * finish on one of the last two heard words: what was said *now* is the
 * evidence for where the reader is now, and the last word alone is exempt
 * only because the engines revise it so often.
 */
function align(heard: readonly string[], cells: readonly Cell[]): Alignment | null {
  const rows = heard.length + 1;
  const cols = cells.length + 1;
  const h = new Array<number>(rows * cols).fill(0);
  // How many diagonal matches in a row end at each cell, so a backward move
  // can insist on a run rather than a total.
  const run = new Array<number>(rows * cols).fill(0);

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const s = score(heard[i - 1]!, cells[j - 1]!.key);
      const diagonal = h[(i - 1) * cols + j - 1]! + s;
      const up = h[(i - 1) * cols + j]! + GAP;
      const left = h[i * cols + j - 1]! + GAP;
      const best = Math.max(0, diagonal, up, left);
      h[i * cols + j] = best;
      run[i * cols + j] = best > 0 && best === diagonal && s > 0 ? run[(i - 1) * cols + j - 1]! + 1 : 0;
    }
  }

  let found: Alignment | null = null;
  for (const i of [rows - 1, rows - 2]) {
    if (i < 1) continue;
    for (let j = 1; j < cols; j += 1) {
      const value = h[i * cols + j]!;
      // Only an alignment that ends on a match places the reader: a trailing
      // gap is a heard word that fits nowhere.
      if (value <= 0 || run[i * cols + j] === 0) continue;
      if (found && value <= found.score) continue;
      found = { word: cells[j - 1]!.word, score: value, run: run[i * cols + j]! };
    }
  }
  return found;
}

/** Whether an alignment is strong enough for the move it implies. */
function acceptable(found: Alignment, position: number): boolean {
  const target = found.word + 1;
  if (Math.abs(target - position) <= NEAR) return found.score >= ACCEPT_NEAR;
  if (target > position) return found.score >= ACCEPT_AHEAD;
  return found.score >= ACCEPT_BACK && found.run >= BACK_RUN;
}

// MARK: - Moving by hand

/** The position after stepping a number of sentences from `position`. */
export function stepSentences(
  words: readonly ScriptWord[],
  position: number,
  sentences: number,
): number {
  const starts = words.filter((word) => word.sentenceStart).map((word) => word.index);
  if (starts.length === 0) return 0;

  // The sentence the position is in: the last start at or before it.
  let current = 0;
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i]! <= position) current = i;
  }

  const target = Math.min(Math.max(current + sentences, 0), starts.length - 1);
  return skipDirections(words, starts[target]!);
}

/** Lands the position on a word the reader pointed at. */
export function jumpTo(words: readonly ScriptWord[], index: number): number {
  return skipDirections(words, Math.min(Math.max(index, 0), words.length));
}

/**
 * The script's own vocabulary, for the engine to favour.
 *
 * Long words only: short ones are already in every model, and a list of "the"
 * is noise. Capped because the engines charge for a long list in latency.
 */
export function vocabulary(words: readonly ScriptWord[], limit = 100): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const word of words) {
    if (word.direction) continue;
    const clean = word.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (clean.length < 5) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(clean);
    if (picked.length >= limit) break;
  }
  return picked;
}
