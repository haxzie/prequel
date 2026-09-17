/**
 * Where a field's cells go, and what names its bitmap.
 *
 * Laid out against a ruler that knows nothing about fonts — ten pixels a
 * glyph — because what matters is not where any glyph lands but that no two
 * cells share a pixel, every cell has its bleed around it, and the name moves
 * whenever the pixels would.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_TEXT_STYLE, type TextField, type TextStyle } from "../../../shared/project";
import { layoutField, textFieldKey, type FieldOptions, type Measure } from "./textBitmap";

const FRAME = { width: 1920, height: 1080 };

const field = (text: string, over: Partial<TextStyle> = {}): TextField => ({
  role: "heading",
  text,
  style: { ...DEFAULT_TEXT_STYLE, ...over },
});

const options = (over: Partial<FieldOptions> = {}): FieldOptions => ({
  frame: FRAME,
  family: "system-ui",
  unit: "block",
  wrap: 1536,
  align: "center",
  fontLoaded: true,
  ...over,
});

/** Ten pixels a glyph, whatever the glyph; a font of 0.8 up and 0.2 down. */
const ruler = (text: string, font: string): Measure => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
  return { width: text.length * 10, ascent: size * 0.8, descent: size * 0.2 };
};

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("layoutField", () => {
  it("draws a field that moves as one as a single cell the size of the extent", () => {
    const layout = layoutField(field("Hello there"), options(), ruler);
    expect(layout.units).toHaveLength(1);
    expect(layout.units[0]!.cell).toEqual({ x: 0, y: 0, ...layout.extent });
    expect(layout.bitmap).toEqual(layout.extent);
  });

  it("gives every unit a cell of its own, padded, inside the sheet", () => {
    for (const unit of ["word", "char"] as const) {
      const layout = layoutField(
        field("Every word makes an entrance", { strokeWidth: 0.05, shadowBlur: 0.1 }),
        options({ unit }),
        ruler,
      );
      const count = unit === "word" ? 5 : "Every word makes an entrance".replace(/ /g, "").length;
      expect(layout.units).toHaveLength(count);

      for (const [index, entry] of layout.units.entries()) {
        expect(entry.cell.x).toBeGreaterThanOrEqual(0);
        expect(entry.cell.y).toBeGreaterThanOrEqual(0);
        expect(entry.cell.x + entry.cell.width).toBeLessThanOrEqual(layout.bitmap.width);
        expect(entry.cell.y + entry.cell.height).toBeLessThanOrEqual(layout.bitmap.height);
        // Padded by at least the bleed on every side: the cell is wider and
        // taller than the run of glyphs by twice it.
        expect(entry.cell.width).toBeGreaterThanOrEqual(layout.bleed * 2);
        expect(entry.cell.height).toBeGreaterThan(layout.bleed * 2);
        for (const other of layout.units.slice(index + 1)) {
          expect(overlaps(entry.cell, other.cell)).toBe(false);
        }
      }
    }
  });

  it("places the units along the line in order, so they read as the line", () => {
    const layout = layoutField(
      field("one two three"),
      options({ unit: "word", align: "left" }),
      ruler,
    );
    const lefts = layout.units.map((unit) => unit.place.x);
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    // The extent is what the units place into, whatever the sheet looks like.
    for (const unit of layout.units) {
      expect(unit.place.x + unit.place.width).toBeLessThanOrEqual(
        layout.extent.width + layout.bleed * 2 + 1,
      );
    }
  });

  it("wraps at the width it was given and keeps a typed line break", () => {
    const one = layoutField(field("aaaa bbbb cccc"), options({ wrap: 80 }), ruler);
    // Two words are 90 px; at 80 every word stands on its own line.
    expect(one.draws.map((draw) => draw.text)).toEqual(["aaaa", "bbbb", "cccc"]);

    const two = layoutField(field("first\nsecond"), options(), ruler);
    expect(two.draws.map((draw) => draw.text)).toEqual(["first", "second"]);
  });

  it("puts the plate under the glyphs and first among the units", () => {
    const layout = layoutField(
      field("hi there", { plateColor: "#000" }),
      options({ unit: "word" }),
      ruler,
    );
    expect(layout.plate).not.toBeNull();
    expect(layout.units[0]!.cell).toEqual(layout.plate!.cell);
    expect(layout.units).toHaveLength(3);
  });

  it("aligns lines inside the extent as asked", () => {
    const text = "long line here\nshort";
    const left = layoutField(field(text), options({ align: "left" }), ruler);
    const right = layoutField(field(text), options({ align: "right" }), ruler);
    const centre = layoutField(field(text), options({ align: "center" }), ruler);
    expect(left.draws[1]!.x).toBe(left.draws[0]!.x);
    expect(right.draws[1]!.x).toBeGreaterThan(right.draws[0]!.x);
    expect(centre.draws[1]!.x).toBeCloseTo((right.draws[1]!.x + left.draws[1]!.x) / 2);
  });

  it("measures the size against the frame's shorter edge", () => {
    const landscape = layoutField(field("x"), options(), ruler);
    const portrait = layoutField(
      field("x"),
      options({ frame: { width: 1080, height: 1920 } }),
      ruler,
    );
    expect(landscape.fontSize).toBe(portrait.fontSize);
  });
});

describe("textFieldKey", () => {
  const base = field("Title");

  it("is stable for the same field drawn the same way", () => {
    expect(textFieldKey(base, options())).toBe(textFieldKey(base, options()));
  });

  it("moves for every leaf that reaches the pixels", () => {
    const changed: Partial<TextStyle>[] = [
      { font: "georgia" },
      { weight: 400 },
      { italic: true },
      { size: 0.1 },
      { color: "#ff0000" },
      { caps: true },
      { tracking: 0.1 },
      { lineHeight: 1.5 },
      { strokeWidth: 0.05 },
      { strokeColor: "#00ff00" },
      { shadowBlur: 0.1 },
      { shadowColor: "#0000ff" },
      { shadowDy: 0.05 },
      { plateColor: "#000000" },
      { plateRadius: 1 },
      { platePadX: 1 },
      { platePadY: 1 },
    ];
    for (const over of changed) {
      expect(textFieldKey(field("Title", over), options())).not.toBe(textFieldKey(base, options()));
    }

    expect(textFieldKey(field("Other"), options())).not.toBe(textFieldKey(base, options()));
    for (const over of [
      { unit: "word" },
      { wrap: 400 },
      { frame: { width: 1280, height: 720 } },
      { align: "left" },
      { family: "Georgia" },
      { fontLoaded: false },
    ] as Partial<FieldOptions>[]) {
      expect(textFieldKey(base, options(over))).not.toBe(textFieldKey(base, options()));
    }
  });
});
