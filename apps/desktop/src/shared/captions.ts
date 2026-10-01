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
export interface CaptionLook {
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
 * How the words arrive — the second axis of a caption, and the one that moves.
 *
 * Split from `CaptionLook` because the two are independent and were not being
 * treated as such: every look carried its own arrival baked in, so choosing a
 * plate meant accepting the fill-in that came with it, and the catalogue had to
 * carry a separate entry for each pairing anybody might want. "Highlight" and
 * "Subtitle" were in fact the same look twice over, differing only here.
 *
 * Three ways in and a way of not bothering. They are exclusive rather than
 * additive: two signals saying which word is being spoken make a line busy
 * rather than clear, which is the note the old table repeated at every entry.
 */
export interface CaptionAnimation {
  id: string;
  label: string;
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
}

/**
 * A look and an arrival, together: what actually gets drawn.
 *
 * The rasteriser and `layout.ts` take one of these rather than the two halves,
 * so neither has to know the axes were ever separate — and neither can pair
 * them differently from the other, which is the usual way a preview and an
 * export come to disagree.
 */
export type CaptionStyle = CaptionLook & Omit<CaptionAnimation, "id" | "label">;


/**
 * The safe look, and the one anything unrecognised falls back to.
 *
 * Named rather than reached as `CAPTION_LOOKS[0]` so the fallback is a
 * definite value: an index into an array is `undefined` as far as the compiler
 * is concerned, and a fallback that can itself be missing is not one.
 */
const SUBTITLE: CaptionLook = {
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
  onLight: null,
  // A hair tight, which is how SF is set at display sizes.
  tracking: -0.01,
  caps: false,
  perWord: false,
};

/**
 * The looks on offer, in the order the picker shows them.
 *
 * "Plain" leads because it is what a new project is set to — see
 * `DEFAULT_CAPTIONS` — and a picker whose default sits fifth reads as though
 * something else were chosen for you.
 *
 * The order carries nothing else. The fallback is `SUBTITLE` by name rather
 * than whatever happens to be first, which is what lets this list be reordered
 * freely: see the note on that constant.
 *
 * **The ids outlive the labels.** `blur` is a look with no blur in it and `pop`
 * is a look that does not pop — both named for the arrival they used to carry,
 * which now lives in `CAPTION_ANIMATIONS`. Renaming them would be tidier and
 * would also silently restyle every project that named one, because
 * `captionLook` falls back rather than throwing: a saved `blur` would stop
 * resolving and come back as a subtitle pill. The labels are what anybody
 * reads, so the labels are what changed.
 */
export const CAPTION_LOOKS: CaptionLook[] = [
  {
    id: "blur",
    label: "Plain",
    // Light. The look is words standing on the footage with nothing behind
    // them, and a heavy face and shouted capitals are a second thing competing
    // to be the point of it.
    weight: 300,
    scale: 1.1,
    fill: "#ffffff",
    stroke: null,
    // Nothing behind the glyphs at all — no plate, no outline, no shadow. The
    // words stand on the footage, which is why the colour has to be chosen
    // against what is behind them rather than assumed.
    shadow: null,
    plate: null,
    // Near-black where the footage is light. The words have no plate and no
    // shadow, so white on a white page is white on a white page — this is what
    // makes the look usable on a screen recording rather than only on footage
    // that happens to be dark.
    onLight: "#101418",
    // Open rather than tight: a light face at caption size closes up, and a
    // word arriving reads better with air around the letters.
    tracking: 0.005,
    caps: false,
    perWord: false,
  },
  SUBTITLE,
  {
    id: "pop",
    label: "Word",
    weight: 800,
    scale: 1.25,
    fill: "#ffffff",
    // No outline. A heavy stroke round a word this large is a second shape
    // competing with the letterform, and the shadow below already lifts it off
    // the footage.
    stroke: null,
    shadow: { color: "rgba(0,0,0,0.5)", blur: 0.2, dy: 0.05 },
    plate: null,
    onLight: null,
    tracking: -0.01,
    caps: true,
    // One word to a cue: the look is a single large word at a time, and the
    // size it wants comes from `scale`, applied when the text is rasterised and
    // therefore sharp. Swelling a lit word at draw time instead meant scaling
    // the bitmap up as it was composited, which is blurry — and, with anything
    // drawn underneath, wrong: a glyph grown about its centre does not cover
    // the one beneath it, because the counters grow too and the smaller strokes
    // show through them.
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
    onLight: null,
    tracking: 0.01,
    caps: false,
    perWord: false,
  },
];

/** Nothing moves: the whole line, every word at full strength, from the off. */
const STILL: CaptionAnimation = {
  id: "none",
  label: "None",
  lit: null,
  dim: null,
  blurIn: null,
};

/**
 * The arrivals on offer, in the order the picker shows them.
 *
 * "Focus" leads for the reason "Plain" does: it is what a new project is set
 * to. `STILL` is last because it is the one somebody goes looking for, rather
 * than the one they are offered.
 */
export const CAPTION_ANIMATIONS: CaptionAnimation[] = [
  {
    id: "focus",
    label: "Focus",
    // Not lit, and nothing held back. The focus clearing off a word already
    // says which word is being spoken, and a second signal saying it too makes
    // the line busy rather than clear.
    lit: null,
    dim: null,
    blurIn: 0.26,
  },
  {
    id: "fill",
    label: "Fill in",
    lit: null,
    // Half, which is as far as white over a dark plate can go and still be read
    // a word ahead of the voice — much below it and the line reads as one word
    // with a grey smear after it.
    dim: 0.5,
    blurIn: null,
  },
  {
    id: "highlight",
    label: "Highlight",
    // Lit but not swollen: on a plate, a word that grows collides with the one
    // beside it, because the plate was measured around the flat layout.
    lit: { pop: 1 },
    // Held back as well as lit, so the line fills in *and* colours — which is
    // what the old "Highlight" look did, and the pairing it is named for.
    dim: 0.5,
    blurIn: null,
  },
  STILL,
];

/**
 * The arrival each look used to carry, by look id.
 *
 * A project saved before the two were separate names a look and nothing else,
 * and resolving that to `STILL` would quietly stop every existing caption from
 * moving. `highlight` is in here although it is no longer a look: it fell in
 * with `subtitle`, whose appearance it shared exactly, and this is the half of
 * it that was not a duplicate.
 */
const WAS: Record<string, string> = {
  blur: "focus",
  subtitle: "fill",
  highlight: "highlight",
  pop: "highlight",
  outline: "none",
  band: "fill",
};

/**
 * The look with this id, or the subtitle pill.
 *
 * Falls back rather than throwing, for the same reason `cursorStyle` does: a
 * project saved by a build that had a look this one does not is still worth
 * opening, and a missing look is a plainer video rather than an editor that
 * will not load the recording.
 */
export function captionLook(id: string): CaptionLook {
  return CAPTION_LOOKS.find((look) => look.id === id) ?? SUBTITLE;
}

/** The arrival with this id, or none. Falls back for the reason above. */
export function captionAnimation(id: string): CaptionAnimation {
  return CAPTION_ANIMATIONS.find((animation) => animation.id === id) ?? STILL;
}

/**
 * The arrival a project means, given what it stored.
 *
 * `animationId` is optional so that a caller holding nothing but an old
 * project's look id still gets what that look always did — see `WAS`.
 */
export function captionArrival(lookId: string, animationId?: string): CaptionAnimation {
  return captionAnimation(animationId ?? WAS[lookId] ?? STILL.id);
}

/**
 * What gets drawn: a look and an arrival resolved into one record.
 *
 * Note the `id` and `label` this comes back with are the *look*'s. Nothing
 * downstream of here needs to name the arrival — `captionArrival` is for the
 * two callers that do.
 */
export function captionStyle(id: string, animationId?: string): CaptionStyle {
  const look = captionLook(id);
  const arrival = captionArrival(id, animationId);
  return {
    ...look,
    lit: arrival.lit,
    // A look with one word to a cue has no rest of the line to hold back, and
    // dimming the only word on screen until it is spoken means it arrives
    // half-strength and then jumps. The arrival keeps its colour change and
    // loses the fill, which is what `pop` did when the two were one record.
    dim: look.perWord ? null : arrival.dim,
    blurIn: arrival.blurIn,
  };
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
