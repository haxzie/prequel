/**
 * Laying a text field out, and drawing it to a bitmap.
 *
 * The other place in the app that measures text, beside `captionBitmap.ts`,
 * and for the reason it gives: laid out once here, at the export frame's
 * size, and both rasterisers only ever blit the pixels.
 *
 * A field is drawn as a sheet of *cells* rather than as one picture of the
 * line, because its units move on their own. A caption's word boxes tile the
 * line and are all on screen at once, so a seam between two of them falls
 * where there is no ink. A text unit that rises, fades or blurs while its
 * neighbour sits still cannot share an edge with it: whatever of the
 * neighbour's shadow or outline fell inside the shared box would move with the
 * wrong word, and the sixteen taps a blur takes read past the crop into the
 * next glyph. So every unit gets a cell of its own, padded on all four sides
 * by everything that can be drawn outside its glyphs, and the plan crops the
 * cell and places it where the unit belongs.
 *
 * A field that moves as one — every motion but the two staggered ones — is
 * one cell, which is the whole field as it reads.
 */
import type { Rect, Size, TextUnit } from "../../../shared/layout";
import type { TextAlign, TextField, TextStyle } from "../../../shared/project";
import { MAX_TEXT_BLUR, type TextUnitKind } from "../../../shared/text-motion";

/**
 * Bumped whenever this file changes what it draws.
 *
 * The same rule `captionBitmap.ts` explains: the key hashes the style, which
 * catches every edit to a style, and cannot catch a change made here. Main
 * never rewrites a file that is already there, so a change to `paint` without
 * a bump leaves every recording drawing the old pixels.
 *
 *   1  the original
 */
const RASTERISER = 1;

/**
 * Room either side of a unit for glyphs that lean out of their advance.
 *
 * An italic `f` reaches past the width `measureText` reports, and a cell cut
 * to the advance would shave it. A quarter of the font size covers every face
 * offered; `actualBoundingBoxLeft` would be exact, but it is per string and
 * a cell padded by a constant can be laid out without a canvas.
 */
const OVERHANG = 0.25;

/**
 * How wide the sheet may grow before cells wrap onto another shelf.
 *
 * A line typed out one glyph at a time is a cell per glyph, each padded; at
 * a 4K frame that is wider than Chromium will allocate a canvas. Shelves keep
 * the sheet inside what the GPU will upload.
 */
const SHEET_WIDTH = 4096;

/** What a measurer says about a string, in bitmap pixels. */
export interface Measure {
  width: number;
  ascent: number;
  descent: number;
}

export interface FieldOptions {
  /** The export frame; every fraction in the style resolves against it. */
  frame: Size;
  /** The whole font stack, fallbacks and all. */
  family: string;
  /** How the field is cut, from the text's motions. */
  unit: TextUnitKind;
  /** How wide a line may run before it wraps, in frame pixels. */
  wrap: number;
  align: TextAlign;
  /**
   * Whether the face really was loaded when this was drawn.
   *
   * Part of the name, so a field drawn in the fallback while a hosted font
   * was still arriving is redrawn once it has — the same file name would
   * otherwise keep the fallback forever.
   */
  fontLoaded: boolean;
}

/** A field laid out: the sheet, the extent, and every cell in both. */
export interface FieldLayout {
  bitmap: Size;
  /** The field as it reads: the box the units place into. */
  extent: Size;
  units: TextUnit[];
  fontSize: number;
  /** What to draw, and where on the sheet. */
  draws: Draw[];
  /** Where the plate goes on the sheet, if the field has one. */
  plate: { cell: Rect; radius: number } | null;
  /** How far outside the glyphs anything is drawn; the plate hugs inside it. */
  bleed: number;
  font: string;
  tracking: number;
}

/** One run of glyphs to draw, at a baseline position on the sheet. */
interface Draw {
  text: string;
  x: number;
  y: number;
}

/**
 * Works out where everything goes without drawing anything.
 *
 * `measure` is the one thing that needs a font engine, and it is handed in so
 * this can be tested with a ruler that knows nothing about fonts.
 */
export function layoutField(
  field: TextField,
  options: FieldOptions,
  measure: (text: string, font: string, tracking: number) => Measure,
): FieldLayout {
  const { style } = field;
  const unit = Math.min(options.frame.width, options.frame.height);
  const fontSize = Math.max(1, style.size * unit);
  const font = `${style.italic ? "italic " : ""}${String(style.weight)} ${String(fontSize)}px ${options.family}`;
  const tracking = style.tracking * fontSize;
  const width = (text: string) => measure(text, font, tracking).width;

  const text = style.caps ? field.text.toUpperCase() : field.text;
  const lines = wrapped(text, Math.max(1, options.wrap), width);

  // Room for whatever is drawn outside the glyphs: the outline reaches half
  // its width past them, a shadow its blur plus its drop, and a motion that
  // arrives out of focus spreads by the widest blur it may ask for. Every one
  // is cut off by the cell's edge otherwise, and a title with its shadow
  // shaved is the kind of thing only noticed on the export.
  const bleed =
    (style.strokeWidth * fontSize) / 2 +
    (style.shadowBlur > 0 ? style.shadowBlur * fontSize + Math.abs(style.shadowDy * fontSize) : 0) +
    MAX_TEXT_BLUR * fontSize;
  const padX = (style.plateColor ? style.platePadX * fontSize : 0) + bleed;
  const padY = (style.plateColor ? style.platePadY * fontSize : 0) + bleed;

  const lineHeight = style.lineHeight * fontSize;
  const sample = measure("Hg", font, tracking);
  // The baseline sits where the glyphs are centred in their line box, so a
  // loose line height leaves the same slack above and below.
  const baseline = (lineHeight - (sample.ascent + sample.descent)) / 2 + sample.ascent;

  const widths = lines.map(width);
  const longest = Math.max(0, ...widths);
  const extent: Size = {
    width: Math.ceil(longest + padX * 2),
    height: Math.ceil(lineHeight * lines.length + padY * 2),
  };

  // Where each line starts, in the extent.
  const lineX = (index: number) =>
    options.align === "left"
      ? padX
      : options.align === "right"
        ? extent.width - padX - (widths[index] ?? 0)
        : (extent.width - (widths[index] ?? 0)) / 2;

  const plateRect: Rect = { x: 0, y: 0, width: extent.width, height: extent.height };
  const radius = style.plateRadius * fontSize;

  if (options.unit === "block") {
    // One cell: the field entire, sheet and extent the same picture.
    return {
      bitmap: extent,
      extent,
      units: [{ cell: plateRect, place: plateRect }],
      fontSize,
      draws: lines.map((line, index) => ({
        text: line,
        x: lineX(index),
        y: padY + lineHeight * index + baseline,
      })),
      plate: style.plateColor ? { cell: plateRect, radius } : null,
      bleed,
      font,
      tracking,
    };
  }

  // Every run along every line, with where it sits in the extent. Measured by
  // advancing along the line the way the drawing does — the width of
  // everything before a run is where that run starts — rather than by
  // measuring runs alone and adding them up, which kerning and tracking make a
  // different number.
  const pad = bleed + OVERHANG * fontSize;
  const runs: { text: string; left: number; top: number; width: number; baseline: number }[] = [];
  lines.forEach((line, index) => {
    const pieces = options.unit === "char" ? [...line] : line.split(" ");
    let before = "";
    for (const [piece, nth] of pieces.map((piece, nth) => [piece, nth] as const)) {
      const joiner = options.unit === "char" || nth === 0 ? "" : " ";
      const after = `${before}${joiner}${piece}`;
      const start = before === "" ? 0 : width(before + joiner);
      const end = width(after);
      before = after;
      if (piece.trim() === "") continue;
      runs.push({
        text: piece,
        left: lineX(index) + start,
        top: padY + lineHeight * index,
        width: end - start,
        baseline,
      });
    }
  });

  // The plate first, as its own unit, so it is drawn under the glyphs and —
  // being first — arrives first when the units are staggered.
  const cells: { place: Rect; draw: Draw | null }[] = [];
  if (style.plateColor) cells.push({ place: plateRect, draw: null });
  for (const run of runs) {
    cells.push({
      place: {
        x: run.left - pad,
        y: run.top - pad,
        width: run.width + pad * 2,
        height: lineHeight + pad * 2,
      },
      draw: { text: run.text, x: pad, y: pad + run.baseline },
    });
  }

  // Shelves: cells laid left to right, a new shelf when the next will not
  // fit, each shelf as tall as its tallest cell.
  const units: TextUnit[] = [];
  const draws: Draw[] = [];
  let plate: FieldLayout["plate"] = null;
  let x = 0;
  let y = 0;
  let shelf = 0;
  let sheetWidth = 0;
  for (const entry of cells) {
    const w = Math.ceil(entry.place.width);
    const h = Math.ceil(entry.place.height);
    if (x > 0 && x + w > SHEET_WIDTH) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    const cell: Rect = { x, y, width: w, height: h };
    units.push({ cell, place: entry.place });
    if (entry.draw) draws.push({ text: entry.draw.text, x: x + entry.draw.x, y: y + entry.draw.y });
    else plate = { cell, radius };
    x += w;
    shelf = Math.max(shelf, h);
    sheetWidth = Math.max(sheetWidth, x);
  }

  return {
    bitmap: { width: Math.max(1, sheetWidth), height: Math.max(1, y + shelf) },
    extent,
    units,
    fontSize,
    draws,
    plate,
    bleed,
    font,
    tracking,
  };
}

/**
 * Breaks a text into lines no wider than `wrap`.
 *
 * Typed line breaks are kept; each paragraph is then filled greedily a word
 * at a time. A single word wider than the wrap stands on its own line rather
 * than being cut — a title is not prose, and a word broken in two reads as a
 * typo.
 */
function wrapped(text: string, wrap: number, width: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ").filter((word) => word !== "");
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (line !== "" && width(candidate) > wrap) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Draws one field, laid out by `layoutField` against a real canvas.
 */
export async function rasteriseField(
  field: TextField,
  options: FieldOptions,
): Promise<{ layout: FieldLayout; bytes: Uint8Array }> {
  const ruler = context(1, 1);
  const layout = layoutField(field, options, (text, font, tracking) => {
    ruler.font = font;
    ruler.letterSpacing = `${String(tracking)}px`;
    const metrics = ruler.measureText(text);
    return {
      width: metrics.width,
      // The font's own ascent and descent, so every line of a field sits at
      // the same height whatever its glyphs. Approximated where the engine
      // does not say, which is only ever a test double.
      ascent: metrics.fontBoundingBoxAscent || layoutFontSize(font) * 0.8,
      descent: metrics.fontBoundingBoxDescent || layoutFontSize(font) * 0.2,
    };
  });

  return { layout, bytes: await paint(layout, field.style) };
}

/** The pixel size out of a font string, for the fallback metrics above. */
function layoutFontSize(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : 16;
}

async function paint(layout: FieldLayout, style: TextStyle): Promise<Uint8Array> {
  const ctx = context(layout.bitmap.width, layout.bitmap.height);
  ctx.font = layout.font;
  ctx.letterSpacing = `${String(layout.tracking)}px`;
  ctx.textBaseline = "alphabetic";

  if (layout.plate && style.plateColor) {
    const { cell, radius } = layout.plate;
    ctx.fillStyle = style.plateColor;
    ctx.beginPath();
    // Inset by the bleed the extent carries, so the plate hugs the words
    // rather than reaching to the edge of the room kept for a shadow.
    const inset = layout.bleed;
    ctx.roundRect(
      cell.x + inset,
      cell.y + inset,
      Math.max(0, cell.width - inset * 2),
      Math.max(0, cell.height - inset * 2),
      radius,
    );
    ctx.fill();
  }

  if (style.shadowBlur > 0) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur * layout.fontSize;
    ctx.shadowOffsetY = style.shadowDy * layout.fontSize;
  }

  for (const draw of layout.draws) {
    if (style.strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth * layout.fontSize;
      // Rounded, so the stroke does not grow spikes off the corners of glyphs.
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeText(draw.text, draw.x, draw.y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(draw.text, draw.x, draw.y);
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
  if (!ctx) throw new Error("no 2d context for a text bitmap");
  return ctx;
}

/**
 * A stable name for what a field draws.
 *
 * Everything the pixels depend on and nothing else, for the reason `cueKey`
 * spells out: the name is what decides whether main rewrites the file.
 * Position, timing and the motions' durations stay out; the unit kind is in,
 * because a field cut into cells is a different picture from the same field
 * drawn whole.
 */
export function textFieldKey(field: TextField, options: FieldOptions): string {
  const parts = [
    RASTERISER,
    field.text,
    JSON.stringify(field.style),
    options.family,
    options.unit,
    Math.round(options.wrap),
    Math.round(options.frame.width),
    Math.round(options.frame.height),
    options.align,
    options.fontLoaded ? "loaded" : "fallback",
  ].join("|");

  // FNV-1a, as `cueKey` uses: two different fields have to get two names, and
  // a name has to be short enough to sit in a directory listing.
  let hash = 0x811c9dc5;
  for (let index = 0; index < parts.length; index += 1) {
    hash ^= parts.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

/** Where a field's bitmap lives inside the recording. */
export function textPath(key: string): string {
  return `texts/${key}.png`;
}
