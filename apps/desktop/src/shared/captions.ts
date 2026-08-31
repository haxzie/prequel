/**
 * Turning what was said into what is drawn.
 *
 * Two things live here, and both are needed by more than one surface, which is
 * why they are in `shared/` rather than beside the panel: the catalogue of
 * caption looks, and the grouping of transcript words into cues.
 *
 * Deliberately free of any `electron`, Node or DOM import. The renderer lays a
 * cue out and rasterises it, the inspector draws a thumbnail from the same
 * style record, and `layout.ts` places the result — three consumers that must
 * agree on what "Pop, at 4% of the shorter edge, at the bottom" means.
 *
 * Nothing here measures text. Glyph metrics only exist where there is a font
 * engine, and the whole point of rasterising a cue to a bitmap once is that the
 * measurement happens in exactly one place.
 */
import type { MediaTime } from "./manifest.js";
import type { TranscriptWord } from "./transcript.js";

/**
 * One caption look.
 *
 * Sizes are fractions of the *font size*, not of the frame, so a style survives
 * the size slider — a stroke that is 8% of the glyph height reads the same at
 * every size, and one stored in pixels turns into a smear at 2× and vanishes at
 * 0.5×. The one exception is `scale`, which multiplies the setting itself so a
 * style can read bigger without moving the slider under the user.
 */
export interface CaptionStyle {
  id: string;
  label: string;
  weight: number;
  /** Multiplies `captionSize`, so a look can run large without the slider moving. */
  scale: number;
  fill: string;
  /** Drawn behind the glyphs. `width` is a fraction of the font size. */
  stroke: { color: string; width: number } | null;
  shadow: { color: string; blur: number; dy: number } | null;
  /**
   * The plate behind the text, or nothing.
   *
   * `full` stretches it the width of the frame rather than fitting the line —
   * the difference between a subtitle pill and a broadcast band.
   */
  plate: { color: string; radius: number; padX: number; padY: number; full: boolean } | null;
  /**
   * Whether the spoken word is lit, and how much larger it is drawn.
   *
   * Non-null means the cue is rasterised twice — once flat, once in the accent
   * colour — and emitted as the two layers `PlanItem.Caption` already expects.
   * `pop` of 1 lights the word without swelling it.
   */
  lit: { pop: number } | null;
  /** Extra letter spacing, as a fraction of the font size. */
  tracking: number;
  caps: boolean;
}

/**
 * The safe look, and the one anything unrecognised falls back to.
 *
 * Named rather than reached as `CAPTION_STYLES[0]` so the fallback is a
 * definite value: an index into an array is `undefined` as far as the compiler
 * is concerned, and a fallback that can itself be missing is not one.
 */
const SUBTITLE: CaptionStyle = {
  id: "subtitle",
  label: "Subtitle",
  weight: 600,
  scale: 1,
  fill: "#ffffff",
  stroke: null,
  shadow: { color: "rgba(0,0,0,0.55)", blur: 0.12, dy: 0.03 },
  plate: { color: "rgba(0,0,0,0.55)", radius: 0.22, padX: 0.45, padY: 0.28, full: false },
  lit: null,
  tracking: 0,
  caps: false,
};

/**
 * The looks on offer.
 *
 * Ordered so the first is the safe one: `captionStyle` falls back to it, and a
 * project written by a build with looks this one does not have still opens.
 */
export const CAPTION_STYLES: CaptionStyle[] = [
  SUBTITLE,
  {
    id: "highlight",
    label: "Highlight",
    weight: 700,
    scale: 1,
    fill: "#ffffff",
    stroke: null,
    shadow: { color: "rgba(0,0,0,0.55)", blur: 0.12, dy: 0.03 },
    plate: { color: "rgba(0,0,0,0.6)", radius: 0.22, padX: 0.45, padY: 0.28, full: false },
    // Lit but not swollen: on a plate, a word that grows collides with the one
    // beside it, because the plate was measured around the flat layout.
    lit: { pop: 1 },
    tracking: 0,
    caps: false,
  },
  {
    id: "pop",
    label: "Pop",
    weight: 800,
    scale: 1.25,
    fill: "#ffffff",
    stroke: { color: "rgba(0,0,0,0.9)", width: 0.09 },
    shadow: { color: "rgba(0,0,0,0.5)", blur: 0.2, dy: 0.05 },
    plate: null,
    // Room to swell because there is no plate to collide with.
    lit: { pop: 1.14 },
    tracking: -0.01,
    caps: true,
  },
  {
    id: "outline",
    label: "Outline",
    weight: 800,
    scale: 1.05,
    fill: "#ffffff",
    stroke: { color: "#000000", width: 0.11 },
    shadow: null,
    plate: null,
    lit: null,
    tracking: 0,
    caps: false,
  },
  {
    id: "band",
    label: "Band",
    weight: 600,
    scale: 0.95,
    fill: "#ffffff",
    stroke: null,
    shadow: null,
    plate: { color: "rgba(0,0,0,0.8)", radius: 0, padX: 0.6, padY: 0.42, full: true },
    lit: null,
    tracking: 0.01,
    caps: false,
  },
  {
    id: "minimal",
    label: "Minimal",
    weight: 500,
    scale: 0.85,
    fill: "#ffffff",
    stroke: null,
    shadow: { color: "rgba(0,0,0,0.7)", blur: 0.16, dy: 0.02 },
    plate: null,
    lit: null,
    tracking: 0.06,
    caps: true,
  },
];

/**
 * The style with this id, or the first one.
 *
 * Falls back rather than throwing, for the same reason `cursorStyle` does: a
 * project saved by a build that had a style this one does not is still worth
 * opening, and a missing look is a plainer video rather than an editor that
 * will not load the recording.
 */
export function captionStyle(id: string): CaptionStyle {
  return CAPTION_STYLES.find((style) => style.id === id) ?? SUBTITLE;
}

/** One word inside a cue, on the session clock, and which line it sits on. */
export interface CueWord {
  text: string;
  at: MediaTime;
  end: MediaTime;
  line: number;
}

export interface Cue {
  at: MediaTime;
  end: MediaTime;
  lines: string[];
  words: CueWord[];
}

/**
 * The longest a cue may stay up.
 *
 * Not a reading-speed limit — the words are already timed. It is the ceiling on
 * how long a lit style can go without the highlight moving, which is what makes
 * a caption look frozen rather than live.
 */
const MAX_CUE_NS = 5_000_000_000;

/**
 * A silence this long ends a cue.
 *
 * Short enough to break at a breath, long enough not to break between two words
 * of the same phrase. Below about half a second this shatters ordinary speech
 * into one-word cues.
 */
const GAP_NS = 700_000_000;

/**
 * How long a cue may be held past its last word to reach the next one.
 *
 * Without this a caption blinks out in every pause between phrases, which reads
 * as flicker rather than as timing. It is only ever extended *towards* the next
 * cue, so two cues never overlap.
 */
const HOLD_NS = 400_000_000;

/** Roughly how many characters fit on a line before it has to wrap. */
const CHARS_PER_LINE = 28;

export interface CueOptions {
  /** How many lines a cue may fill before it has to break. */
  lines: number;
}

/**
 * Groups transcript words into cues.
 *
 * Pure, and tested as such. Every break rule below exists because the obvious
 * grouping — fixed word counts — produces captions that split mid-clause and
 * hold a stale line through a pause.
 */
export function cuesFrom(words: readonly TranscriptWord[], options: CueOptions): Cue[] {
  const maxLines = Math.max(1, Math.round(options.lines));
  const cues: Cue[] = [];

  let current: CueWord[] = [];
  let line = 0;
  let lineLength = 0;

  const flush = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;

    const lines: string[] = [];
    for (const word of current) {
      const so_far = lines[word.line];
      lines[word.line] = so_far ? `${so_far} ${word.text}` : word.text;
    }

    cues.push({
      at: first.at,
      end: last.end,
      // Holes are impossible — `line` only ever advances by one — but an empty
      // string is still safer to hand a rasteriser than a hole in an array.
      lines: lines.map((text) => text ?? ""),
      words: current,
    });

    current = [];
    line = 0;
    lineLength = 0;
  };

  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;

    const previous = current[current.length - 1];
    const opened = current[0];
    if (previous && opened) {
      const silence = word.at - previous.end >= GAP_NS;
      const overlong = word.end - opened.at > MAX_CUE_NS;
      // The punctuation is on the *previous* word: a full stop ends the cue it
      // belongs to, rather than starting the next one.
      const sentence = /[.!?]["')\]]?$/.test(previous.text);

      if (silence || overlong || sentence) flush();
    }

    // Measured after the flush, so the width test is against the line this word
    // is actually going onto.
    if (current.length > 0 && lineLength + 1 + text.length > CHARS_PER_LINE) {
      if (line + 1 >= maxLines) {
        flush();
      } else {
        line += 1;
        lineLength = 0;
      }
    }

    current.push({ text, at: word.at, end: word.end, line });
    lineLength += (lineLength === 0 ? 0 : 1) + text.length;
  }

  flush();

  // Held towards the next cue, never past it. Done in a second pass because a
  // cue cannot know its successor while it is still being filled.
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (!cue) continue;
    const next = cues[index + 1];
    const reach = cue.end + HOLD_NS;
    cue.end = next ? Math.min(reach, next.at) : reach;
  }

  return cues;
}
