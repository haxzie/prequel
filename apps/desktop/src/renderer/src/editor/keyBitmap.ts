/**
 * One shortcut chord, drawn to a bitmap.
 *
 * Here, in Chromium, because text is drawn nowhere else: the exporter has no
 * font engine and deliberately none — see `plan.rs`. What leaves here is a PNG
 * of the whole row, caps and plate together, which `layout.ts` places as an
 * `overlay` item and both rasterisers blit with the code they already have.
 *
 * The whole row as one picture rather than a cap at a time, unlike a text
 * field's cells: the caps of a chord never move independently — they arrive
 * together, sit still and leave together — so there is nothing a seam between
 * them could get wrong, and one bitmap is one draw.
 *
 * The geometry is `shared/keystrokes.ts`'s, not this file's. `layout.ts` has
 * to know the bitmap's shape to place it, and a second idea of how wide a cap
 * is would be a row drawn at one size and placed at another.
 */
import {
  capWidth,
  chordExtent,
  KEY_BLEED,
  KEY_GAP,
  KEY_GLYPH,
  KEY_RADIUS,
  type KeyPlate,
} from "../../../shared/keystrokes";

/**
 * Bumped whenever this file changes what it draws.
 *
 * The same rule `textBitmap.ts` explains: the name is a hash of everything the
 * pixels depend on, which catches every setting and cannot catch an edit here.
 * Main never rewrites a file that is already there, so a change to `paint`
 * without a bump leaves every recording drawing the old pixels.
 *
 *   1  the original
 *   2  a dark plate under white legends, and no shadows anywhere
 */
const RASTERISER = 2;

/**
 * The cap height a chord is drawn at, in the bitmap's own pixels.
 *
 * Fixed, and generous: the bitmap is scaled to whatever the size slider says,
 * and drawing it at the slider's own size would mean re-rasterising the whole
 * recording's chords on every frame of a drag. 128 is above what a 4K export
 * asks of a cap at the top of the range, so it is never enlarged.
 */
const CAP_PX = 128;

export interface ChordStyle {
  plate: KeyPlate;
  /** The legends' colour, as hex. */
  color: string;
  /** How opaque the dark plate behind them is, 0 to 1. */
  opacity: number;
  /** The face, as a CSS family list — `useFonts` resolves the id to this. */
  family: string;
}

/**
 * The plate's own colour.
 *
 * Fixed, and dark: a key cap on a video is read against whatever footage
 * happens to be behind it, and the one backing that works on all of it is a
 * dark one with the legend in light. The control beside it sets how much of
 * that backing there is, which is the question somebody actually has — "can I
 * still see the recording through it" — rather than what colour it should be.
 *
 * Near-black rather than black: a true black plate on a dark recording reads
 * as a hole punched in the picture.
 */
const PLATE = "#14161a";

/**
 * A stable name for what a chord draws.
 *
 * Everything the pixels depend on and nothing else — the caps, the dressing,
 * the face — so two clips wearing the same style share one file and a slider
 * that moves the row across the frame rewrites nothing.
 */
export function chordKey(keys: readonly string[], style: ChordStyle): string {
  const parts = [
    RASTERISER,
    keys.join(" "),
    style.plate,
    style.color,
    // Three places, matching `keyStyleId` exactly. Two looks the plan tells
    // apart must not share one bitmap: at two places, 0.620 and 0.6204 were
    // two looks with one picture between them, and whichever of the two clips
    // was drawn second found no chord tagged for it and drew nothing.
    style.opacity.toFixed(3),
    style.family,
  ].join("|");

  // FNV-1a, as the captions and texts use: two different chords have to get
  // two names, and a name has to be short enough to sit in a listing.
  let hash = 0x811c9dc5;
  for (let index = 0; index < parts.length; index += 1) {
    hash ^= parts.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

/** Where a chord's bitmap lives inside the recording. */
export function chordPath(key: string): string {
  return `keys/${key}.png`;
}

/** The bitmap one chord is drawn into, in its own pixels. */
export function chordBitmap(keys: readonly string[]): { width: number; height: number } {
  const extent = chordExtent(keys, CAP_PX);
  return { width: Math.ceil(extent.width), height: Math.ceil(extent.height) };
}

/**
 * Draws the chord, and hands back the PNG.
 *
 * Async for the one reason the text rasteriser is: `convertToBlob` is, and a
 * synchronous encode of a canvas this size would be on the frame's critical
 * path.
 */
export async function rasteriseChord(
  keys: readonly string[],
  style: ChordStyle,
): Promise<Uint8Array> {
  const size = chordBitmap(keys);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for a chord bitmap");

  const bleed = KEY_BLEED * CAP_PX;
  const gap = KEY_GAP * CAP_PX;
  const radius = KEY_RADIUS * CAP_PX;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${String(KEY_GLYPH * CAP_PX)}px ${style.family}`;

  // The whole row on one plate, where that is the dressing. Drawn before the
  // caps so the legends sit on it, and sized to the caps rather than to the
  // bitmap — the bleed is room the row keeps round itself, not part of the bar.
  if (style.plate === "bar") {
    plate(ctx, bleed, bleed, size.width - bleed * 2, CAP_PX, radius, style, true);
  }

  let x = bleed;
  for (const key of keys) {
    const width = capWidth(key, CAP_PX);

    if (style.plate === "keys") {
      plate(ctx, x, bleed, width, CAP_PX, radius, style, true);
    } else if (style.plate === "outline") {
      plate(ctx, x, bleed, width, CAP_PX, radius, style, false);
    }

    // The legend, in the colour it was given and nothing else behind it. No
    // shadow on any dressing: a cap is a flat object on a flat plate, and a
    // drop shadow under a letter that is already sitting on its own backing
    // reads as a sticker rather than as a key.
    ctx.fillStyle = style.color;
    // Optically centred rather than exactly: the arrows and ⌘ sit high in
    // their em box, and a cap with its legend on the geometric middle reads
    // as sitting low.
    ctx.fillText(key, x + width / 2, bleed + CAP_PX * 0.52);

    x += width + gap;
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * One rounded key: a dark plate, or the outline of one.
 *
 * Filled, it is `PLATE` at whatever strength the control says — never the
 * legend's colour, which goes on top of it. Hollow, it is the legend's colour,
 * because an outline *is* part of the lettering rather than a backing for it.
 */
function plate(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  style: ChordStyle,
  filled: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = style.opacity;

  if (filled) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = PLATE;
    ctx.fill();
  } else {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(height * 0.045, 1);
    // Inset by half the width, so the stroke sits inside the key it traces
    // rather than straddling its edge — the same rule the compositor's own
    // stroke follows.
    ctx.beginPath();
    ctx.roundRect(
      x + ctx.lineWidth / 2,
      y + ctx.lineWidth / 2,
      width - ctx.lineWidth,
      height - ctx.lineWidth,
      radius,
    );
    ctx.stroke();
  }

  ctx.restore();
}
