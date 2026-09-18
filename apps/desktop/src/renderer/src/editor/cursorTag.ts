/**
 * The name tag beside a collaborator-style pointer, as a bitmap.
 *
 * Drawn here, in Chromium, because text is drawn nowhere else: the exporter
 * has no font engine and deliberately none — see `plan.rs`. What leaves here
 * is a square PNG with the tag in its top-left corner, and the two numbers
 * that place it against the pointer, so `layout.ts` can emit it as a second
 * `cursor` item and both rasterisers draw it with the code they already have.
 *
 * Square because a `cursor` item is square, and top-left because the item's
 * hotspot is a fraction of the whole: with the tag in the corner, the fraction
 * that puts the pointer's tip up and left of it is the same whatever the
 * name's length.
 */
import type { CursorTag } from "../../../shared/layout";

/**
 * Proportions, as multiples of the pointer's drawn size.
 *
 * Measured off a multiplayer canvas at its default zoom, where the pointer is
 * about 24 px tall: the tag's top-left sits about 14 px right of and 18 px
 * below the tip, the tag is about 22 px tall, and its text about 12 px. Every
 * figure here is that observation divided by 24, so the tag keeps its place
 * and its weight at whatever size the pointer is drawn.
 */
const OFFSET_X = 0.58;
const OFFSET_Y = 0.75;
const TAG_HEIGHT = 0.92;
const FONT_SIZE = 0.5;
const PAD_X = 0.38;
const RADIUS = 0.25;

/**
 * The pointer's size in the bitmap's own pixels.
 *
 * Large, for the reason the pointer PNGs are 128 px: the tag is scaled down
 * to the pointer's drawn size, and a 4K frame draws a pointer at well over a
 * hundred pixels. Drawn at 128 the text is crisp at any size the slider
 * allows and soft at none.
 */
const POINTER_PX = 128;

/** Longest name drawn. A tag is a name, not a sentence; past this it is cut. */
export const MAX_NAME = 24;

/**
 * The font. The system's UI face, semibold, as the tags in the canvases this
 * imitates are set — and the one face guaranteed to be on every Mac.
 */
const FAMILY = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif";

/** Bumped when the drawing changes, so an old bitmap on disk is not reused. */
const RASTERISER = "tag-1";

/**
 * A stable name for a tag's bitmap: everything the pixels depend on and
 * nothing else, so the same tag is the same file and main skips the rewrite.
 * FNV-1a, as `textFieldKey` uses.
 */
export function cursorTagKey(colour: string, name: string): string {
  const parts = [RASTERISER, colour, trimName(name)].join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < parts.length; index += 1) {
    hash ^= parts.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Where a tag's bitmap lives inside the recording. */
export function cursorTagPath(key: string): string {
  return `cursor/${key}.png`;
}

/** The name as drawn: trimmed, one line, and no longer than `MAX_NAME`. */
export function trimName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

/** What `rasteriseTag` hands back: the pixels, and how to place them. */
export interface RasterisedTag {
  bytes: Uint8Array;
  /** The bitmap itself, for the preview to draw without a round trip to disk. */
  image: ImageBitmap;
  /** `scale` and `hotspot` for the plan, with `path` left to the caller. */
  placement: Omit<CursorTag, "path">;
}

/**
 * Draws one tag.
 *
 * The square's side is whatever the tag needs plus the offset in front of it,
 * so the pointer's tip — at (−OFFSET_X, −OFFSET_Y) in pointer units from the
 * tag's corner — is the same fraction of the side however wide the name is.
 */
export async function rasteriseTag(colour: string, name: string): Promise<RasterisedTag> {
  const text = trimName(name);
  const font = `600 ${String(FONT_SIZE * POINTER_PX)}px ${FAMILY}`;

  const ruler = context(1, 1);
  ruler.font = font;
  const width = ruler.measureText(text).width + PAD_X * POINTER_PX * 2;
  const height = TAG_HEIGHT * POINTER_PX;

  // Square, with a pixel to spare so the rounded corner's antialiasing is not
  // cut at the edge.
  const side = Math.ceil(Math.max(width, height)) + 2;
  const ctx = context(side, side);

  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, RADIUS * POINTER_PX);
  ctx.fill();

  ctx.font = font;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, PAD_X * POINTER_PX, height / 2);

  const blob = await ctx.canvas.convertToBlob({ type: "image/png" });
  const [bytes, image] = await Promise.all([
    blob.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    createImageBitmap(blob),
  ]);

  return {
    bytes,
    image,
    placement: {
      scale: side / POINTER_PX,
      // The tip is up and left of the bitmap's corner by the offset, so the
      // hotspot — the point of the bitmap that lands on the tip — is outside
      // it, at a negative fraction of the side.
      hotspot: {
        x: -(OFFSET_X * POINTER_PX) / side,
        y: -(OFFSET_Y * POINTER_PX) / side,
      },
    },
  };
}

function context(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for a cursor tag");
  return ctx;
}
