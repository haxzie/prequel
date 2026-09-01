/**
 * The swatch grids are five wide, and both palettes have to fill whole rows.
 *
 * A count that is not a multiple of five leaves a ragged last row; a long one
 * silently drops entries, since the grid has no scroll. Neither is visible in
 * code review, and both look like carelessness rather than a bug.
 */
import { describe, expect, it } from "vitest";

import {
  evenSize,
  findPreset,
  FRAME_PRESETS,
  gradientCss,
  GRADIENT_PRESETS,
  presetForSize,
  SOLID_PRESETS,
} from "./presets.js";
import { DEFAULT_BACKGROUND } from "./project.js";

const HEX = /^#[0-9a-f]{6}$/;

describe("solid presets", () => {
  it("leaves exactly one cell for the colour picker", () => {
    // Fourteen plus the picker fills three rows of five.
    expect(SOLID_PRESETS).toHaveLength(14);
    expect((SOLID_PRESETS.length + 1) % 5).toBe(0);
  });

  it("are all six-digit lowercase hex", () => {
    // The swatch compares against the stored value case-insensitively, but the
    // canvas and the Rust parser both want a plain `#rrggbb`.
    for (const color of SOLID_PRESETS) expect(color).toMatch(HEX);
  });

  it("has no duplicates", () => {
    expect(new Set(SOLID_PRESETS).size).toBe(SOLID_PRESETS.length);
  });
});

describe("gradient presets", () => {
  it("fills whole rows", () => {
    // No custom option here, so every cell is a preset.
    expect(GRADIENT_PRESETS).toHaveLength(15);
    expect(GRADIENT_PRESETS.length % 5).toBe(0);
  });

  it("are all six-digit lowercase hex", () => {
    for (const preset of GRADIENT_PRESETS) {
      expect(preset.from).toMatch(HEX);
      expect(preset.to).toMatch(HEX);
    }
  });

  it("never pairs a colour with itself", () => {
    // A gradient between one colour and the same colour is a solid, and reads
    // as a broken preset rather than a subtle one.
    for (const preset of GRADIENT_PRESETS) {
      expect(preset.from).not.toBe(preset.to);
    }
  });

  it("has a distinct name for every entry", () => {
    // The name is the React key and the tooltip.
    expect(new Set(GRADIENT_PRESETS.map((p) => p.name)).size).toBe(GRADIENT_PRESETS.length);
  });

  it("has no duplicate colour pairs", () => {
    const pairs = GRADIENT_PRESETS.map((p) => `${p.from}-${p.to}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("renders as CSS the swatch and the canvas both understand", () => {
    expect(gradientCss({ from: "#000000", to: "#ffffff", angle: 135 })).toBe(
      "linear-gradient(135deg, #000000, #ffffff)",
    );
  });
});

describe("the default background", () => {
  it("is a shipped picture, not the desktop", () => {
    // The desktop was the better idea — a recording sitting on the wallpaper it
    // was taken against reads as one image — but capturing it depends on
    // finding the desktop behind every window, and when that fails the first
    // thing anyone sees is a blank frame. It is still offered as `My wallpaper`.
    expect(DEFAULT_BACKGROUND.background).toEqual({
      kind: "image",
      source: "preset",
      path: "monterey.jpg",
    });
  });
});

describe("frame presets", () => {
  it("are all even, so H.264 can encode them", () => {
    for (const preset of FRAME_PRESETS) {
      expect(preset.width % 2).toBe(0);
      expect(preset.height % 2).toBe(0);
    }
  });

  it("finds a preset by id", () => {
    expect(findPreset("9:16")?.height).toBe(1920);
    expect(findPreset("nope")).toBeUndefined();
    expect(findPreset(null)).toBeUndefined();
  });

  it("labels a size that happens to match one", () => {
    expect(presetForSize(1080, 1920)).toBeDefined();
    expect(presetForSize(999, 111)).toBeUndefined();
  });
});

describe("evenSize", () => {
  it("rounds an odd edge down", () => {
    expect(evenSize(1081)).toBe(1080);
  });

  it("clamps out of range values", () => {
    expect(evenSize(2)).toBe(16);
    expect(evenSize(99_999)).toBe(7680);
  });
});
