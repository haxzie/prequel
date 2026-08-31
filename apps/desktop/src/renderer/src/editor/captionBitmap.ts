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
import type { CaptionStyle, Cue } from "../../../shared/captions";
import type { CaptionWord, Size } from "../../../shared/layout";

/**
 * The face captions are set in: SF, the system's own.
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
const FAMILY = 'system-ui, "Helvetica Neue", Arial, sans-serif';

/** Baseline to baseline, as a multiple of the font size. */
const LINE_HEIGHT = 1.25;

/**
 * Slack around each word box, as a fraction of the font size.
 *
 * The lit layer is cropped out of the bitmap by these boxes, so anything drawn
 * outside the glyphs — the stroke, the shadow — has to be inside them, or the
 * lit word loses its outline the moment it lights up.
 */
const WORD_PAD = 0.14;

/**
 * How far the lit layer's glyphs are widened to cover the flat ones beneath,
 * as a fraction of the font size.
 *
 * Small enough not to read as a weight change, large enough to swallow a
 * glyph's antialiasing at the sizes a caption is set at.
 */
const LIT_COVER = 0.05;

export interface CaptionLayout {
  bitmap: Size;
  /** The bitmap's size as a fraction of the frame it was laid out against. */
  size: Size;
  words: CaptionWord[];
}

export interface CueOptions {
  frame: Size;
  /** `captionSize`: cap height as a fraction of the frame's shorter edge. */
  size: number;
  accent: string;
}

/**
 * Draws one cue, flat and — for a look that lights the spoken word — lit.
 *
 * The two bitmaps are laid out by the same measurement with only the fill
 * colour changed, so the lit word lands exactly over the flat one it replaces.
 */
export async function rasteriseCue(
  cue: Cue,
  style: CaptionStyle,
  options: CueOptions,
): Promise<{ layout: CaptionLayout; flat: Uint8Array; lit: Uint8Array | null }> {
  const measured = measure(cue, style, options);

  const flat = await paint(style, measured, null);
  const lit = style.lit ? await paint(style, measured, options.accent) : null;

  return { layout: measured.layout, flat, lit };
}

interface Measured {
  layout: CaptionLayout;
  font: string;
  fontSize: number;
  tracking: number;
  lines: { text: string; x: number; y: number }[];
  plate: { width: number; height: number; radius: number } | null;
}

/**
 * Works out the bitmap's size and where everything sits inside it.
 *
 * Split from the drawing so the flat and lit passes cannot disagree about the
 * layout: they are handed one measurement rather than each taking their own.
 */
function measure(cue: Cue, style: CaptionStyle, options: CueOptions): Measured {
  const unit = Math.min(options.frame.width, options.frame.height);
  const fontSize = Math.max(1, options.size * style.scale * unit);
  const font = `${style.weight} ${fontSize}px ${FAMILY}`;
  const tracking = style.tracking * fontSize;

  const ctx = context(1, 1);
  ctx.font = font;
  ctx.letterSpacing = `${tracking}px`;

  const texts = cue.lines.map((line) => (style.caps ? line.toUpperCase() : line));
  const widths = texts.map((text) => ctx.measureText(text).width);
  const longest = Math.max(0, ...widths);

  // Room for whatever is drawn outside the glyphs. A stroke reaches half its
  // width either side; a shadow reaches its blur plus its drop. Both are cut
  // off by the bitmap's edge otherwise, and a caption with its outline shaved
  // is the kind of thing only noticed on the export.
  const bleed =
    (style.stroke ? (style.stroke.width * fontSize) / 2 : 0) +
    (style.shadow ? style.shadow.blur * fontSize + Math.abs(style.shadow.dy * fontSize) : 0);

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
      words: style.lit ? wordBoxes(cue, ctx, lines, fontSize, tracking, style) : [],
    },
    font,
    fontSize,
    tracking,
    lines,
    plate: style.plate ? { width, height, radius: style.plate.radius * fontSize } : null,
  };
}

/**
 * Where each word sits in the bitmap.
 *
 * Measured by advancing along the line the way the drawing does — the width of
 * everything before a word is where that word starts — rather than by measuring
 * words in isolation and adding a space. Kerning and letter spacing make those
 * two different numbers, and the difference is a highlight that drifts further
 * right with every word on the line.
 */
function wordBoxes(
  cue: Cue,
  ctx: OffscreenCanvasRenderingContext2D,
  lines: Measured["lines"],
  fontSize: number,
  tracking: number,
  style: CaptionStyle,
): CaptionWord[] {
  if (!style.lit) return [];

  const pad = WORD_PAD * fontSize;
  const lineHeight = fontSize * LINE_HEIGHT;
  const boxes: CaptionWord[] = [];
  const consumed = new Map<number, string>();

  for (const word of cue.words) {
    const line = lines[word.line];
    if (!line) continue;

    const before = consumed.get(word.line) ?? "";
    const text = style.caps ? word.text.toUpperCase() : word.text;
    const after = before === "" ? text : `${before} ${text}`;
    consumed.set(word.line, after);

    const start = before === "" ? 0 : ctx.measureText(`${before} `).width;
    const width = ctx.measureText(after).width - start;

    boxes.push({
      at: word.at,
      end: word.end,
      x: Math.max(0, line.x + start - pad),
      y: Math.max(0, line.y - fontSize - pad),
      width: width + pad * 2,
      height: lineHeight + pad * 2,
      scale: style.lit.pop,
    });
  }

  return boxes;
}

/** Draws one pass. `fill` overrides the style's own colour for the lit layer. */
/**
 * Draws one pass.
 *
 * `lit` is the accent colour on the layer that carries the spoken word, and
 * null on the flat layer underneath it. The two differ by more than the fill —
 * see the plate and the stroke below — so it is the mode, not just a colour.
 */
async function paint(
  style: CaptionStyle,
  measured: Measured,
  lit: string | null,
): Promise<Uint8Array> {
  const { bitmap } = measured.layout;
  const ctx = context(bitmap.width, bitmap.height);

  ctx.font = measured.font;
  ctx.letterSpacing = `${measured.tracking}px`;
  ctx.textBaseline = "alphabetic";

  // The plate goes on the flat layer only.
  //
  // The lit word is a rectangle cropped out of this bitmap and drawn *over* the
  // flat one, so a translucent plate here composites on top of the translucent
  // plate already there — 0.55 over 0.55 is 0.80, a visibly darker box behind
  // the one word being spoken. It looked exactly like a second background under
  // the highlight, which is what it was.
  //
  // There is no hole to worry about either way: source-over leaves what is
  // underneath alone wherever this layer is transparent.
  if (lit === null && style.plate && measured.plate) {
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

  for (const line of measured.lines) {
    if (!line.text) continue;

    // Rounded, so a stroke does not grow spikes off the corners of glyphs at
    // the widths a caption outline needs.
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;

    if (style.stroke) {
      ctx.strokeStyle = style.stroke.color;
      ctx.lineWidth = style.stroke.width * measured.fontSize;
      ctx.strokeText(line.text, line.x, line.y);
    } else if (lit !== null) {
      // A hairline in the accent, on the lit layer of a look that has no stroke
      // of its own.
      //
      // The flat layer has already drawn this word in white at exactly this
      // size, and the lit one is laid over it. Where a glyph edge is half
      // covered, half the white underneath survives — a pale halo around every
      // word as it lights. Widening the accent by a fraction of a pixel covers
      // it. Looks that swell the lit word do not need this: a bigger glyph
      // already hides the one beneath.
      ctx.strokeStyle = lit;
      ctx.lineWidth = LIT_COVER * measured.fontSize;
      ctx.strokeText(line.text, line.x, line.y);
    }

    ctx.fillStyle = lit ?? style.fill;
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
    JSON.stringify(style),
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

/** Where a cue's bitmaps live inside the recording. */
export function cuePaths(key: string): { flat: string; lit: string } {
  return { flat: `captions/${key}.png`, lit: `captions/${key}-lit.png` };
}
