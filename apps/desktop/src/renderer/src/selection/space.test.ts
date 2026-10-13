/**
 * The unit the overlay draws in, against the unit the recording is cropped in.
 *
 * The case that matters is the one that cost a day of recordings: a 1512-point
 * display whose overlay laid out at 1656 CSS pixels. Every rectangle came back
 * a tenth too big, and nothing downstream could tell — a crop is a crop
 * whatever it was measured in.
 */
import { describe, expect, it } from "vitest";

import { SAME, spaceOf, toPixels, toPoints } from "./space";

const DISPLAY = { width: 1512, height: 982 };

describe("the overlay's scale", () => {
  it("is one when the viewport is the display", () => {
    expect(spaceOf(DISPLAY, { width: 1512, height: 982 })).toEqual(SAME);
  });

  it("is the ratio when the renderer measures in a unit of its own", () => {
    const space = spaceOf(DISPLAY, { width: 1656, height: 1076 });

    expect(space.x).toBeCloseTo(0.913, 3);
    expect(space.y).toBeCloseTo(0.913, 3);
  });

  it("is one rather than infinite before the window is on screen", () => {
    // A viewport of nothing is a window that has not been shown yet. Wrong by
    // nothing beats a division by zero carried into a crop.
    expect(spaceOf(DISPLAY, { width: 0, height: 0 })).toEqual(SAME);
  });

  it("scales each axis on its own", () => {
    const space = spaceOf({ width: 1000, height: 800 }, { width: 2000, height: 800 });

    expect(space).toEqual({ x: 0.5, y: 1 });
  });
});

describe("a region crossing between the two", () => {
  it("never leaves the display it was drawn on", () => {
    // The failure itself: a drag across the whole of a 1656-pixel viewport is
    // the whole of a 1512-point display, not a region a tenth off the side of
    // it — which is what ScreenCaptureKit was being asked to crop.
    const space = spaceOf(DISPLAY, { width: 1656, height: 1076 });
    const whole = toPoints({ x: 0, y: 0, width: 1656, height: 1076 }, space);

    expect(whole.width).toBeCloseTo(1512, 6);
    expect(whole.height).toBeCloseTo(982, 6);
  });

  it("puts a window outline where the window is", () => {
    const space = spaceOf(DISPLAY, { width: 1656, height: 1076 });
    const outline = toPixels({ x: 0, y: 33, width: 1512, height: 949 }, space);

    expect(outline.y).toBeCloseTo(36.16, 2);
    expect(outline.width).toBeCloseTo(1656, 6);
  });

  it("comes back where it started", () => {
    const space = spaceOf(DISPLAY, { width: 1656, height: 1076 });
    const drawn = { x: 120, y: 64, width: 400, height: 300 };

    const round = toPixels(toPoints(drawn, space), space);

    expect(round.x).toBeCloseTo(drawn.x, 6);
    expect(round.y).toBeCloseTo(drawn.y, 6);
    expect(round.width).toBeCloseTo(drawn.width, 6);
    expect(round.height).toBeCloseTo(drawn.height, 6);
  });
});
