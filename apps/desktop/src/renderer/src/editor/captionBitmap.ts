/**
 * Laying a cue out, and drawing it to a bitmap.
 *
 * The only place in the app that measures text. `plan.rs` spells out why: text
 * laid out twice — Chromium for the preview, CoreText for the export — is the
 * same class of mistake as a camera positioned twice, and it goes wrong after
 * the file is written. So a cue is measured and drawn once, here, to a PNG, and
 * both rasterisers only ever blit those pixels.
 *
 * The word boxes come out of the same `measureText` calls that positioned the
 * glyphs rather than from a second pass, so the highlight cannot come to sit
 * beside the word it is lighting.
 *
 * Everything is drawn at the *export* frame's size, never the preview's. One
 * set of bitmaps then serves both, and the preview simply samples them down —
 * which is also why `RenderedCue.size` is a fraction of the frame rather than a
 * count of pixels.
 */
import type { CaptionStyle, Cue, CueWord } from "../../../shared/captions";
import type { CaptionWord, Size } from "../../../shared/layout";

/**
 * What the face was before it was a choice, kept as the note it carries.
 *
 * The list now lives in `controls/fonts.ts` and the stack arrives through
 * `CueOptions.family`; this is left here because the measurements below are the
 * reason that list leads with `system-ui` and offers no `"SF Pro Display"`.
 *
 * `system-ui` first, and this order matters. Canvas 2D does *not* resolve
 * `-apple-system` or `BlinkMacSystemFont` — both measure identically to a font
 * name that does not exist, so a stack led by them falls through to whatever
 * comes next. That is not a theory: at 600 weight and 64px, "Handgloves 123"
 * measures 432.06 under `-apple-system`, `"SF Pro Display"` and a deliberately
 * bogus name alike, 484.86 under Helvetica Neue, and 459.82 under `system-ui`.
 * This stack led with `-apple-system` and so set every caption in Helvetica
 * Neue, which is what "the font is very bad" turned out to mean.
 *
 * `"SF Pro Display"` is not a way to ask for it either — macOS ships SF only as
 * the dot-prefixed internal `.SF NS` family, so the public name resolves to
 * nothing. `system-ui` is the only handle on it.
 */
export const SYSTEM_FAMILY = 'system-ui, "Helvetica Neue", Arial, sans-serif';

/** Baseline to baseline, as a multiple of the font size. */
const LINE_HEIGHT = 1.25;

/**
 * Slack around each word box, as a fraction of the font size.
 *
 * A word cropped out of a bitmap by one of these boxes brings with it whatever
 * is drawn outside its glyphs — the stroke, the shadow — only if that fits
 * inside the box, or the word loses its outline the moment it lights up. Only
 * `tight` needs it: the boxes that tile a line already reach their neighbours.
 */
const WORD_PAD = 0.14;

/**
 * Bumped whenever this file changes what it draws.
 *
 * The style record says *what* a cue looks like and `cueKey` hashes it, which
 * catches every change made by editing `CAPTION_STYLES`. It cannot catch a
 * change made here: moving the plate off the lit layer altered every lit
 * bitmap in the app without altering a single style, so the names stayed put,
 * main skipped the writes — it never rewrites a file that is already there —
 * and recordings went on drawing the old pixels. The fix looked like it had
 * not worked, twice.
 *
 * So: change `measure` or `paint` in a way that shows, and bump this.
 *
 *   1  the original
 *   2  plate off the lit layer, hairline in the accent to cover the flat
 *      layer's glyph edges underneath
 *   3  that hairline removed again — it made the lit word heavier than its
 *      neighbours, which reads as the word printed twice rather than as
 *      emphasis
 *   4  a look that fills its line as it is spoken draws its flat layer held
 *      back, so the words still to come sit under the ones already said
 *   5  a cue is a stack of layers rather than a flat one and a lit one, so a
 *      look can say three things about a word — to come, being said, said
 */
const RASTERISER = 5;

export interface CaptionLayout {
  bitmap: Size;
  /** The bitmap's size as a fraction of the frame it was laid out against. */
  size: Size;
}

/**
 * One layer of a cue: a bitmap, and the boxes the plan crops out of it.
 *
 * A cue is drawn as a stack rather than as one picture because what a word
 * looks like depends on when you ask. A look that fills its line as it is
 * spoken says three different things about the same word — still to come,
 * being said, already said — and a bitmap says one. So each is a layer, laid
 * out by the same measurement as the others so a word lands exactly over
 * itself, and the plan crops the moments it wants out of each.
 *
 * `words` empty means the whole layer is drawn for the length of the cue,
 * which is what the layer underneath everything always is.
 */
export interface CueLayer {
  /**
   * What this layer is called on disk, or "" for the one underneath.
   *
   * Part of the file name rather than an index, so a look gaining a layer does
   * not silently rename another look's bitmaps into a picture they are not.
   */
  name: string;
  bytes: Uint8Array;
  words: CaptionWord[];
}

export interface CueOptions {
  frame: Size;
  /** `captionSize`: cap height as a fraction of the frame's shorter edge. */
  size: number;
  accent: string;
  /** The whole stack, fallbacks and all — see `CAPTION_FONTS`. */
  family: string;
}

/**
 * Draws one cue as the stack of layers its look asks for.
 *
 * Every layer comes out of one measurement, so no two of them can disagree
 * about where a word sits — which is the whole reason the word being lit lands
 * on the word it is lighting.
 */
export async function rasteriseCue(
  cue: Cue,
  style: CaptionStyle,
  options: CueOptions,
): Promise<{ layout: CaptionLayout; layers: CueLayer[] }> {
  const measured = measure(cue, style, options);
  const layers: CueLayer[] = [];

  // The layer the others stand on: the plate, and the whole line — held back
  // where the look fills it in as it is spoken, whole where it does not.
  //
  // Its boxes are whatever this layer is the only one for. A look that shows
  // one word at a time crops to that word; one that brings each word into
  // focus draws a quad per word so each can carry its own blur; everything
  // else draws the line entire and lets the layers above say which word is
  // which.
  layers.push({
    name: "",
    bytes: await paint(measured, style, {
      // In the accent where one word to a cue *is* the light. There is no line
      // of unspoken words for it to sit in, and drawing a white copy under it
      // was what made that look like two texts: a glyph does not cover another
      // glyph through its own counters.
      colour: style.perWord && style.lit ? options.accent : style.fill,
      base: true,
    }),
    words: style.perWord
      ? tight(measured, style)
      : style.blurIn !== null
        ? tiles(
            measured,
            (word) => ({ at: word.at, end: cue.end }),
            style.blurIn * measured.fontSize,
          )
        : [],
  });

  // The words already said, in the look's own colour, over the held-back line.
  //
  // Where the look also lights the word being spoken, a word joins this layer
  // when it stops being that word rather than when it starts. The three states
  // are then disjoint: nothing is drawn twice, and the accent never has to
  // cover a white copy of the same glyph to be seen.
  if (style.dim !== null) {
    layers.push({
      name: "said",
      bytes: await paint(measured, style, { colour: style.fill, base: false }),
      words: tiles(measured, (word) => ({ at: style.lit ? word.end : word.at, end: cue.end }), 0),
    });
  }

  // The one word being spoken, in the accent, for its own moment and no
  // longer. That is what reads as the voice moving along the line; a word that
  // kept the accent afterwards would read as the line changing colour instead.
  if (style.lit && !style.perWord) {
    layers.push({
      name: "now",
      bytes: await paint(measured, style, { colour: options.accent, base: false }),
      words: tiles(measured, (word) => ({ at: word.at, end: word.end }), 0),
    });
  }

  return { layout: measured.layout, layers };
}

interface Measured {
  layout: CaptionLayout;
  font: string;
  fontSize: number;
  tracking: number;
  /** Baseline to baseline, in bitmap pixels. */
  lineHeight: number;
  /** The slack above the first line and below the last. */
  padY: number;
  lines: { text: string; x: number; y: number }[];
  plate: { width: number; height: number; radius: number } | null;
  /**
   * Where every word sits, from the same pass that placed the glyphs.
   *
   * Measured here rather than by each layer, so a box cannot come to sit
   * beside the word it is meant to be cropping.
   */
  placed: Placed[];
}

/**
 * Works out the bitmap's size and where everything sits inside it.
 *
 * Split from the drawing so no two layers can disagree about the layout: they
 * are handed one measurement rather than each taking their own.
 */
function measure(cue: Cue, style: CaptionStyle, options: CueOptions): Measured {
  const unit = Math.min(options.frame.width, options.frame.height);
  const fontSize = Math.max(1, options.size * style.scale * unit);
  const font = `${style.weight} ${fontSize}px ${options.family}`;
  const tracking = style.tracking * fontSize;

  const ctx = context(1, 1);
  ctx.font = font;
  ctx.letterSpacing = `${tracking}px`;

  const texts = cue.lines.map((line) => (style.caps ? line.toUpperCase() : line));
  const widths = texts.map((text) => ctx.measureText(text).width);
  const longest = Math.max(0, ...widths);

  // Room for whatever is drawn outside the glyphs. A stroke reaches half its
  // width either side; a shadow reaches its blur plus its drop; a word drawn
  // out of focus spreads by its radius. All are cut off by the bitmap's edge
  // otherwise, and a caption with its outline shaved is the kind of thing only
  // noticed on the export.
  const bleed =
    (style.stroke ? (style.stroke.width * fontSize) / 2 : 0) +
    (style.shadow ? style.shadow.blur * fontSize + Math.abs(style.shadow.dy * fontSize) : 0) +
    (style.blurIn ?? 0) * fontSize;

  const padX = (style.plate ? style.plate.padX * fontSize : 0) + bleed;
  const padY = (style.plate ? style.plate.padY * fontSize : 0) + bleed;

  const lineHeight = fontSize * LINE_HEIGHT;

  // A band runs the width of the frame; a pill only fits its own line.
  const width = style.plate?.full ? Math.round(options.frame.width) : Math.ceil(longest + padX * 2);
  const height = Math.ceil(lineHeight * texts.length + padY * 2);

  const lines = texts.map((text, index) => ({
    text,
    x: (width - (widths[index] ?? 0)) / 2,
    // The baseline sits a font size down each line box, which leaves the slack
    // a 1.25 line height carries under the descenders.
    y: padY + lineHeight * index + fontSize,
  }));

  return {
    layout: {
      bitmap: { width, height },
      size: { width: width / options.frame.width, height: height / options.frame.height },
    },
    font,
    fontSize,
    tracking,
    lineHeight,
    padY,
    lines,
    plate: style.plate ? { width, height, radius: style.plate.radius * fontSize } : null,
    placed: advances(cue, ctx, lines, style),
  };
}

/**
 * The line cut into a quad per word, each covering its own share of the bitmap.
 *
 * Boxes that meet rather than boxes that fit. Every look that draws a word at
 * a time puts several quads on screen at once, so two boxes that overlap would
 * each redraw part of the other's word: over a blur that is a soft copy
 * printed on a sharp one, and over a held-back line it is two half-transparent
 * edges stacked, which is a fringe round every word. Meeting halfway through
 * the space between two words puts every seam where there is no ink, and
 * reaching the bitmap's own edges at the ends of the line gives the outermost
 * words the room a blur spreads into.
 *
 * `span` is what makes one layer differ from the next: the same boxes, drawn
 * at different moments.
 */
function tiles(
  measured: Measured,
  span: (word: CueWord) => { at: number; end: number },
  blur: number,
): CaptionWord[] {
  const { placed, padY, lineHeight } = measured;
  const bitmap = measured.layout.bitmap;

  return placed.map(({ word, line, left, right, index, onLine, lastOnLine }) => {
    // Halfway to the neighbour on each side, and out to the bitmap's edge
    // where there is none.
    const from = onLine === 0 ? 0 : (placed[index - 1]!.right + left) / 2;
    const to = lastOnLine ? bitmap.width : (right + placed[index + 1]!.left) / 2;
    // The line's own band, the same way: lines tile too, or a word's box would
    // reach into the line above and redraw part of it.
    const top = line.index === 0 ? 0 : padY + lineHeight * line.index;
    const bottom = line.last ? bitmap.height : padY + lineHeight * (line.index + 1);

    return {
      ...span(word),
      x: from,
      y: top,
      width: to - from,
      height: bottom - top,
      // Never swollen. These boxes tile, so growing one would push it over the
      // word beside it — which is the collision `perWord` exists to avoid, and
      // the reason no look both fills its line and pops.
      scale: 1,
      blur,
    };
  });
}

/**
 * A box round each word and nothing more, for a layer that crops to one word
 * at a time and can afford to grow it.
 */
function tight(measured: Measured, style: CaptionStyle): CaptionWord[] {
  const pad = WORD_PAD * measured.fontSize;

  return measured.placed.map(({ word, line, left, right }) => ({
    at: word.at,
    end: word.end,
    x: Math.max(0, left - pad),
    y: Math.max(0, line.y - measured.fontSize - pad),
    width: right - left + pad * 2,
    height: measured.lineHeight + pad * 2,
    scale: style.lit?.pop ?? 1,
    blur: 0,
  }));
}

/**
 * Where each word starts and ends along its line, in bitmap pixels.
 *
 * Measured by advancing along the line the way the drawing does — the width of
 * everything before a word is where that word starts — rather than by measuring
 * words in isolation and adding a space. Kerning and letter spacing make those
 * two different numbers, and the difference is a highlight that drifts further
 * right with every word on the line.
 */
interface Placed {
  word: CueWord;
  line: { y: number; index: number; last: boolean };
  left: number;
  right: number;
  /** Position in the whole cue, and along its own line. */
  index: number;
  onLine: number;
  lastOnLine: boolean;
}

function advances(
  cue: Cue,
  ctx: OffscreenCanvasRenderingContext2D,
  lines: Measured["lines"],
  style: CaptionStyle,
): Placed[] {
  const consumed = new Map<number, string>();
  const counts = new Map<number, number>();
  for (const word of cue.words) counts.set(word.line, (counts.get(word.line) ?? 0) + 1);

  const placed: Placed[] = [];
  for (const word of cue.words) {
    const line = lines[word.line];
    if (!line) continue;

    const before = consumed.get(word.line) ?? "";
    const text = style.caps ? word.text.toUpperCase() : word.text;
    const after = before === "" ? text : `${before} ${text}`;
    consumed.set(word.line, after);

    const start = before === "" ? 0 : ctx.measureText(`${before} `).width;
    const width = ctx.measureText(after).width - start;
    const onLine = placed.filter((other) => other.word.line === word.line).length;

    placed.push({
      word,
      line: { y: line.y, index: word.line, last: word.line === lines.length - 1 },
      left: line.x + start,
      right: line.x + start + width,
      index: placed.length,
      onLine,
      lastOnLine: onLine === (counts.get(word.line) ?? 1) - 1,
    });
  }

  return placed;
}

/**
 * Draws one layer.
 *
 * `base` is the layer the rest stand on, and it alone carries the plate and
 * the holding back of a look that fills its line in as it is spoken. The
 * layers above are glyphs and nothing else.
 *
 * The plate is base-only because a word above it is a rectangle cropped out of
 * its own bitmap and drawn *over* this one: a translucent plate on both would
 * composite 0.55 over 0.55 — a visibly darker box behind the word being
 * spoken, which is exactly what it looked like when every layer carried one.
 * There is no hole to worry about the other way, since source-over leaves what
 * is underneath alone wherever a layer is transparent.
 */
async function paint(
  measured: Measured,
  style: CaptionStyle,
  layer: { colour: string; base: boolean },
): Promise<Uint8Array> {
  const { bitmap } = measured.layout;
  const ctx = context(bitmap.width, bitmap.height);

  ctx.font = measured.font;
  ctx.letterSpacing = `${measured.tracking}px`;
  ctx.textBaseline = "alphabetic";

  if (layer.base && style.plate && measured.plate) {
    ctx.fillStyle = style.plate.color;
    ctx.beginPath();
    ctx.roundRect(0, 0, measured.plate.width, measured.plate.height, measured.plate.radius);
    ctx.fill();
  }

  if (style.shadow) {
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur * measured.fontSize;
    ctx.shadowOffsetY = style.shadow.dy * measured.fontSize;
  }

  // The whole line held back, on the layer underneath a look that fills in as
  // it is spoken. After the plate deliberately: the plate is what the words
  // are read against, and fading it with them would leave the box behind the
  // caption growing darker word by word as the layers above land on it.
  if (layer.base && style.dim !== null) ctx.globalAlpha = style.dim;

  for (const line of measured.lines) {
    if (!line.text) continue;

    if (style.stroke) {
      ctx.strokeStyle = style.stroke.color;
      ctx.lineWidth = style.stroke.width * measured.fontSize;
      // Rounded, so the stroke does not grow spikes off the corners of glyphs
      // at the widths a caption outline needs.
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeText(line.text, line.x, line.y);
    }

    // Layers differ by their colour and nothing else.
    //
    // Not for want of trying otherwise: a word above is drawn over the line
    // below it at the same size, so a half-covered glyph edge keeps some of
    // what is underneath, and widening the upper glyphs to cover that fringe
    // was the obvious fix. It is the wrong one. A word visibly heavier than
    // the ones beside it does not read as emphasis — it reads as the same word
    // printed twice, slightly out of register, which is exactly how it was
    // reported. A 1px fringe is the cheaper artefact of the two.
    ctx.fillStyle = layer.colour;
    ctx.fillText(line.text, line.x, line.y);
  }

  const blob = await ctx.canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

function context(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for a caption bitmap");
  return ctx;
}

/**
 * A stable name for what a cue draws.
 *
 * The *whole* style record, not its id. A name is what decides whether main
 * rewrites a bitmap — it skips a file that is already there — so anything the
 * pixels depend on has to be in here or an edit silently keeps the old picture.
 *
 * That is not hypothetical. This hashed `style.id` alone, so changing a plate's
 * colour, or moving the plate out of the bitmap and back, produced the same
 * name every time: the file was never rewritten, and a recording went on
 * drawing captions from a build two changes ago. Serialising the record means a
 * new look cannot forget to invalidate its own bitmaps.
 *
 * Position and visibility stay out of it deliberately — neither changes a
 * pixel, so moving the captions up the frame re-places what is already on disk.
 * The frame width is in it because bitmaps are measured against the export
 * frame, and exporting at another size has to re-measure.
 */
export function cueKey(cue: Cue, style: CaptionStyle, options: CueOptions): string {
  const parts = [
    RASTERISER,
    JSON.stringify(style),
    // The face is part of what was drawn, so it has to be part of what names
    // it. Left out, two fonts would agree on a key and the second would be
    // handed the first one's bitmap off disk — a font that changes the picker
    // and nothing on screen.
    options.family,
    options.size.toFixed(4),
    Math.round(options.frame.width),
    style.lit ? options.accent : "",
    cue.lines.join("|"),
  ].join("|");

  // FNV-1a. Not a cryptographic need: this only has to tell two different cues
  // apart, and a name has to be short enough to sit in a directory listing.
  let hash = 0x811c9dc5;
  for (let index = 0; index < parts.length; index += 1) {
    hash ^= parts.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

/** Where one of a cue's layers lives inside the recording. */
export function cuePath(key: string, name: string): string {
  return `captions/${key}${name ? `-${name}` : ""}.png`;
}
