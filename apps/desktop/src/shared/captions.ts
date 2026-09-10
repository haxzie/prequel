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
  /**
   * How solid a word is before it is spoken, as a fraction of full strength,
   * or null for a look that draws its whole line at once.
   *
   * The line is on screen from the moment the cue is and fills in as it is
   * said: the words still to come are held back, the ones already spoken are
   * whole. Two states rather than something that moves, which is why it is
   * baked into the bitmap rather than applied when the word is drawn — the
   * flat layer carries the dimmed line, and the layer over it draws each word
   * at full strength from the moment it is said. That is the two-layer
   * machinery a lit look already uses, so this costs the plan nothing.
   *
   * Not so low that a word still to come cannot be read. Reading a little
   * ahead of the voice is how captions are read, and a look that hides what is
   * coming has stopped being one.
   */
  dim: number | null;
  /**
   * How far out of focus a word sits before it is spoken, as a fraction of the
   * font size, or null for a look that draws every word sharp.
   *
   * The whole line is on screen from the moment the cue is; the words that
   * have not been reached yet are simply soft, and each comes into focus as it
   * is said. That is why this is applied when the word is drawn rather than
   * when it is rasterised — it changes over the word's own first moments, and
   * a bitmap cannot change. `captionAt` turns it into the radius for a given
   * instant, and both rasterisers soften the quad by exactly that much.
   *
   * A look that carries one is drawn a quad per word rather than one for the
   * line, because a blur belongs to a draw. `captionItems` is where that
   * happens.
   */
  blurIn: number | null;
  /**
   * The colour to use where what is behind the words is light, or null to draw
   * them in `fill` whatever they land on.
   *
   * `fill` is then the colour for a dark backdrop, and the two are chosen
   * between while the frame is drawn — the compositor measures the pixels it
   * has already put down under the caption. That is the only place the answer
   * exists: a recording zooms, scrolls and cuts, so what is behind a given
   * word is not known when the words are laid out.
   *
   * Only for a look with nothing behind its glyphs. A plate or an outline
   * carries its own contrast and has no need of this.
   */
  onLight: string | null;
  /** Extra letter spacing, as a fraction of the font size. */
  tracking: number;
  caps: boolean;
  /**
   * One word to a cue, rather than a line of them.
   *
   * Required by any look that swells the word it lights. The lit word is drawn
   * over a flat layer that still holds the whole line, so growing it by a
   * seventh pushes it about ten pixels into the space either side — and the gap
   * between two words is about ten pixels. It lands on top of its neighbours.
   *
   * With one word to a cue there are no neighbours to land on, which is also
   * the look these styles are imitating: a single word at a time, large.
   */
  perWord: boolean;
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
  weight: 500,
  scale: 1,
  fill: "#ffffff",
  stroke: null,
  // No shadow. A tight dark blur behind white glyphs does not read as depth at
  // caption size, it reads as a badly drawn outline — the plate is what carries
  // the contrast here, so the glyph edges are better left clean.
  shadow: null,
  plate: { color: "rgba(8,10,14,0.55)", radius: 0.34, padX: 0.5, padY: 0.3, full: false },
  lit: null,
  // Held back until it is said. Half, which is as far as white over this plate
  // can go and still be read a word ahead of the voice — much below it and the
  // line reads as one word with a grey smear after it.
  dim: 0.5,
  blurIn: null,
  onLight: null,
  // A hair tight, which is how SF is set at display sizes.
  tracking: -0.01,
  caps: false,
  perWord: false,
};

/**
 * The looks on offer, in the order the picker shows them.
 *
 * "Blur in" leads because it is what a new project is set to — see
 * `DEFAULT_SETTINGS` — and a picker whose default sits fifth reads as though
 * something else were chosen for you.
 *
 * The order carries nothing else. The fallback is `SUBTITLE` by name rather
 * than whatever happens to be first, which is what lets this list be reordered
 * freely: see the note on that constant.
 */
export const CAPTION_STYLES: CaptionStyle[] = [
  {
    id: "blur",
    label: "Blur in",
    // Light, and set as it was spoken. The look is the focus moving along the
    // line; a heavy face and shouted capitals are a second thing competing to
    // be the point of it.
    weight: 300,
    scale: 1.1,
    fill: "#ffffff",
    stroke: null,
    // Nothing behind the glyphs at all — no plate, no outline, no shadow. The
    // words stand on the footage, which is why the colour has to be chosen
    // against what is behind them rather than assumed.
    shadow: null,
    plate: null,
    // Not lit. The whole line is on screen and the blur is what says which
    // word is being spoken, so a second colour would be saying it twice.
    lit: null,
    // Nothing held back either, for the same reason: the focus is already
    // saying which word is being spoken, and a second signal saying it too
    // makes the line busy rather than clear.
    dim: null,
    blurIn: 0.26,
    // Near-black where the footage is light. The words have no plate and no
    // shadow, so white on a white page is white on a white page — this is what
    // makes the look usable on a screen recording rather than only on footage
    // that happens to be dark.
    onLight: "#101418",
    // Open rather than tight: a light face at caption size closes up, and the
    // blur clearing off a word reads better with air around the letters.
    tracking: 0.005,
    caps: false,
    // A full line, like every look but `pop`. The words are drawn a quad each
    // so they can come into focus one at a time, which is not the same thing
    // as showing them one at a time.
    perWord: false,
  },
  SUBTITLE,
  {
    id: "highlight",
    label: "Highlight",
    weight: 500,
    scale: 1,
    fill: "#ffffff",
    stroke: null,
    // As `subtitle`: the plate carries the contrast, so the glyphs stay clean.
    shadow: null,
    plate: { color: "rgba(8,10,14,0.55)", radius: 0.34, padX: 0.5, padY: 0.3, full: false },
    // Lit but not swollen: on a plate, a word that grows collides with the one
    // beside it, because the plate was measured around the flat layout.
    lit: { pop: 1 },
    // The same half as `subtitle`, so the two looks differ by the colour the
    // line fills with rather than by how hard they hold the rest of it back.
    dim: 0.5,
    blurIn: null,
    onLight: null,
    tracking: -0.01,
    caps: false,
    perWord: false,
  },
  {
    id: "pop",
    label: "Pop",
    weight: 800,
    scale: 1.25,
    fill: "#ffffff",
    // No outline. A heavy stroke round a word this large is a second shape
    // competing with the letterform, and the shadow below already lifts it off
    // the footage.
    stroke: null,
    shadow: { color: "rgba(0,0,0,0.5)", blur: 0.2, dy: 0.05 },
    plate: null,
    // Lit, but not swollen at draw time.
    //
    // Swelling meant scaling the bitmap up as it was composited, which is both
    // blurry and — while anything was drawn underneath — wrong: a glyph grown
    // about its centre does not cover the one beneath it, because the counters
    // grow too and the smaller strokes show through them. The size this look
    // wants comes from `scale`, which is applied when the text is rasterised
    // and therefore sharp.
    lit: { pop: 1 },
    // One word to a cue, so there is no rest of the line to hold back.
    dim: null,
    blurIn: null,
    onLight: null,
    tracking: -0.01,
    caps: true,
    perWord: true,
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
    // Nothing held back. The look is a hard outline on every word, and a word
    // at half strength inside a full-strength outline reads as a mistake.
    dim: null,
    blurIn: null,
    onLight: null,
    tracking: 0,
    caps: false,
    perWord: false,
  },
  {
    id: "band",
    label: "Band",
    weight: 500,
    scale: 0.95,
    fill: "#ffffff",
    stroke: null,
    shadow: null,
    // The same dark as the pill styles, so the looks read as one family and a
    // band is a difference of shape rather than of colour.
    plate: { color: "rgba(8,10,14,0.55)", radius: 0, padX: 0.6, padY: 0.42, full: true },
    lit: null,
    dim: 0.5,
    blurIn: null,
    onLight: null,
    tracking: 0.01,
    caps: false,
    perWord: false,
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

/**
 * Sounds that are speech but not words.
 *
 * Both engines transcribe verbatim, so a take that opens "Uh, we..." captions
 * as "Uh, we..." — which is faithful and reads badly. Matched by token rather
 * than by a confidence floor, deliberately: a floor drops whatever the engine
 * was least sure of, and what it is least sure of is quiet real words. This
 * list only ever removes sounds that carry nothing.
 */
const FILLER = /^(u+h+|u+m+|e+r+|e+rm+|a+h+|m+h+m+|h+m+|mm+|uh-huh|er+m*)[.,!?]*$/i;

/** Whether a word is a filler sound rather than something that was said. */
export function isFiller(text: string): boolean {
  return FILLER.test(text.trim());
}

export interface CueOptions {
  /** How many lines a cue may fill before it has to break. */
  lines: number;
  /**
   * One word to a cue, for a look that swells the word it lights.
   *
   * The line budget is ignored when this is set: a cue is one word, so it is
   * one line whatever the budget says.
   */
  perWord?: boolean;
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
    // Dropped before anything else, so a cue's timing is measured across the
    // words that are actually drawn — a filler kept in the span would hold the
    // caption up waiting for a sound nobody reads.
    if (isFiller(text)) continue;

    // One to a cue, and none of the grouping below applies: there is no line to
    // fill, no sentence to end and no silence to break on.
    if (options.perWord) {
      current.push({ text, at: word.at, end: word.end, line: 0 });
      flush();
      continue;
    }

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
