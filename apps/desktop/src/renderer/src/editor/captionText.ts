/**
 * The words of a transcript as text that can be typed into, and back again.
 *
 * The captions editor is a plain run of text, because that is what correcting
 * a transcript feels like — retype the misheard word, delete the false start.
 * But a caption is timed, and text has no time in it. So every edit is worked
 * out against the words it was typed over: a word that did not change keeps
 * the time the recogniser gave it, and a run that did inherits the time of the
 * run it replaced. Nothing here touches React or the DOM, so the rules can be
 * tested on their own.
 */
import type { MediaTime } from "../../../shared/manifest";
import type { TranscriptWord } from "../../../shared/transcript";
import { toProjectTime, type PlacedSlice } from "./timeline";

/** The text split into the words it will be timed as. */
export function tokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Above this many cells the diff is not worth running.
 *
 * A full alignment is old × new words. Over a five-thousand-word take that is
 * twenty-five million cells on every keystroke, which is a visible pause in
 * the editor. The common prefix and suffix are stripped first, so a keystroke
 * leaves a handful of words to align and only a pasted paragraph gets near
 * this — and a paragraph timed uniformly across the span it replaced is still
 * right, just less finely so.
 */
const DIFF_CELLS = 400 * 400;

/**
 * The words after `text` has been typed over `previous`.
 *
 * Returns `previous` itself — the same reference — when nothing but whitespace
 * changed, so a caller can skip the edit rather than record one.
 */
export function realignWords(previous: readonly TranscriptWord[], text: string): TranscriptWord[] {
  const next = tokens(text);
  const before = previous.map((word) => word.text);

  if (next.length === before.length && next.every((token, index) => token === before[index])) {
    return previous as TranscriptWord[];
  }

  // Strip what is the same at either end before aligning what is left. The
  // suffix is bounded so it cannot overlap the prefix when one side is a
  // prefix of the other.
  let prefix = 0;
  while (prefix < before.length && prefix < next.length && before[prefix] === next[prefix]) {
    prefix += 1;
  }
  const shortest = Math.min(before.length, next.length) - prefix;
  let suffix = 0;
  while (
    suffix < shortest &&
    before[before.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMiddle = previous.slice(prefix, before.length - suffix);
  const newMiddle = next.slice(prefix, next.length - suffix);
  const following = previous[before.length - suffix];

  const out: TranscriptWord[] = previous.slice(0, prefix);
  const runs = runsBetween(oldMiddle, newMiddle);

  // A start moved later by words inserted in front of the very first word.
  // Applied as that word is copied across rather than to the word itself,
  // because the objects in `previous` belong to the caller.
  let trimNextTo: MediaTime | null = null;
  const keep = (word: TranscriptWord) => {
    out.push(trimNextTo === null ? word : { ...word, at: trimNextTo });
    trimNextTo = null;
  };

  for (const run of runs) {
    if (run.kind === "keep") {
      keep(run.word);
      continue;
    }
    if (run.tokens.length === 0) continue; // A deletion leaves a gap.

    if (run.words.length > 0) {
      const first = run.words[0]!;
      const last = run.words.at(-1)!;
      out.push(...spread(run.tokens, first.at, last.end));
      continue;
    }

    trimNextTo = insert(out, run.tokens, run.next ?? following);
  }

  for (const word of previous.slice(before.length - suffix)) keep(word);
  return out;
}

type Run =
  | { kind: "keep"; word: TranscriptWord }
  | {
      kind: "change";
      /** The words being replaced. Empty for a pure insertion. */
      words: TranscriptWord[];
      /** What they are replaced by. Empty for a pure deletion. */
      tokens: string[];
      /** The kept word an insertion sits in front of, when there is one. */
      next: TranscriptWord | undefined;
    };

/**
 * The middle of the edit as alternating kept words and changed runs.
 *
 * A longest common subsequence rather than a character diff: the unit that
 * carries time is the word, and the question is which words are still there.
 */
function runsBetween(words: readonly TranscriptWord[], tokens: readonly string[]): Run[] {
  const matches = words.length * tokens.length > DIFF_CELLS ? [] : commonSubsequence(words, tokens);

  const runs: Run[] = [];
  let i = 0;
  let j = 0;

  const changeUpTo = (wordEnd: number, tokenEnd: number, next: TranscriptWord | undefined) => {
    if (i === wordEnd && j === tokenEnd) return;
    runs.push({
      kind: "change",
      words: words.slice(i, wordEnd),
      tokens: tokens.slice(j, tokenEnd),
      next,
    });
    i = wordEnd;
    j = tokenEnd;
  };

  for (const [wordIndex, tokenIndex] of matches) {
    changeUpTo(wordIndex, tokenIndex, words[wordIndex]);
    runs.push({ kind: "keep", word: words[wordIndex]! });
    i = wordIndex + 1;
    j = tokenIndex + 1;
  }
  changeUpTo(words.length, tokens.length, undefined);

  return runs;
}

/** Index pairs of the longest run of words that survive, in order. */
function commonSubsequence(
  words: readonly TranscriptWord[],
  tokens: readonly string[],
): [number, number][] {
  const rows = words.length + 1;
  const cols = tokens.length + 1;
  const table = new Uint16Array(rows * cols);

  for (let i = words.length - 1; i >= 0; i -= 1) {
    for (let j = tokens.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        words[i]!.text === tokens[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < words.length && j < tokens.length) {
    if (words[i]!.text === tokens[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return pairs;
}

/**
 * Tokens laid across a span, each taking a share by its length.
 *
 * By characters rather than evenly: "a" and "unfortunately" typed over one
 * word should not light for the same time. Rounded per boundary and pinned to
 * the span's own end, so the run neither overshoots nor leaves a sliver.
 */
function spread(tokens: readonly string[], start: MediaTime, end: MediaTime): TranscriptWord[] {
  const weights = tokens.map((token) => Math.max(1, token.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const span = end - start;

  const out: TranscriptWord[] = [];
  let at = start;
  let used = 0;
  for (const [index, token] of tokens.entries()) {
    used += weights[index]!;
    const to = index === tokens.length - 1 ? end : start + Math.round((span * used) / total);
    out.push({ at, end: to, text: token, confidence: 1 });
    at = to;
  }

  return out;
}

/**
 * Words typed where none were, given the time of what is either side.
 *
 * They take the silence between their neighbours when there is any. Failing
 * that, the tail of the word before — its end moves earlier and its start
 * does not, so nothing in front of it changes order. With no word before, the
 * head of the word after. With no words at all there is nothing to measure
 * against, and they sit at the origin with no length: a caption that never
 * lights is the honest outcome of text with no recording behind it.
 *
 * Neither zero-width nor overlapping, because `captionAt` needs `at < end` to
 * light a word, and a look that pops the spoken word would skip one with no
 * time to pop in.
 *
 * Returns the start the word after should be moved to when its head was
 * taken, or null when it was not touched. The caller applies it, because that
 * word is not in `out` yet.
 */
function insert(
  out: TranscriptWord[],
  tokens: readonly string[],
  next: TranscriptWord | undefined,
): MediaTime | null {
  const previous = out.at(-1);
  const from = previous?.end ?? 0;
  const to = next?.at;

  if (to !== undefined && to > from) {
    out.push(...spread(tokens, from, to));
    return null;
  }

  if (previous) {
    const shared = spread([previous.text, ...tokens], previous.at, previous.end);
    out[out.length - 1] = { ...previous, end: shared[0]!.end };
    out.push(...shared.slice(1));
    return null;
  }

  if (next) {
    const shared = spread([...tokens, next.text], next.at, next.end);
    out.push(...shared.slice(0, -1));
    return shared.at(-1)!.at;
  }

  out.push(...tokens.map((token) => ({ at: 0, end: 0, text: token, confidence: 1 })));
  return null;
}

/**
 * The words the edit still plays, and the ones that lie in cut-out footage.
 *
 * Judged by where a word begins: a word whose start was cut away has lost the
 * moment it would light, and a word beginning exactly on a cut belongs to the
 * later clip, the same way the half-open slice ranges say it does.
 */
export function survivingWords(
  words: readonly TranscriptWord[],
  placed: readonly PlacedSlice[],
): { visible: TranscriptWord[]; hidden: TranscriptWord[] } {
  const visible: TranscriptWord[] = [];
  const hidden: TranscriptWord[] = [];

  for (const word of words) {
    (toProjectTime(placed, word.at) === null ? hidden : visible).push(word);
  }

  return { visible, hidden };
}

/**
 * The words spoken during one clip, and every other word.
 *
 * The captions editor is scoped to whatever is selected, the way the rest of
 * the inspector is: with a clip in hand it shows that clip's words, and with
 * nothing selected it shows the whole take. `rest` is what has to be carried
 * back through an edit — the words of the other clips are still the
 * recording's, and an edit to this clip must not drop them.
 *
 * By where a word begins, like `survivingWords`, and half-open at the end for
 * the same reason: a word starting exactly on a cut belongs to the clip that
 * plays it, not to the one that ends there.
 */
export function wordsWithin(
  words: readonly TranscriptWord[],
  source: { start: MediaTime; end: MediaTime } | null,
): { shown: TranscriptWord[]; rest: TranscriptWord[] } {
  if (source === null) return { shown: [...words], rest: [] };

  const shown: TranscriptWord[] = [];
  const rest: TranscriptWord[] = [];

  for (const word of words) {
    (word.at >= source.start && word.at < source.end ? shown : rest).push(word);
  }

  return { shown, rest };
}

/**
 * The edited words put back among the ones the editor could not show.
 *
 * The editor only ever sees the words that still play, so an edit comes back
 * without the ones in cut-out footage — and those have to survive, or undoing
 * the cut would bring the footage back without its captions.
 */
export function mergeWords(
  hidden: readonly TranscriptWord[],
  edited: readonly TranscriptWord[],
): TranscriptWord[] {
  return [...hidden, ...edited].sort((a, b) => a.at - b.at);
}
