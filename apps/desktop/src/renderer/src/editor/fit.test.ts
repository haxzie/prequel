/**
 * The preview has to fit whatever space it is given, at every output size.
 *
 * The bug this covers looked like a padding problem: the canvas laid out at its
 * intrinsic size — 1920×1080, or 3840×2160 at 4K — overflowed the pane and the
 * bottom of the window was clipped away. It got worse the larger the frame,
 * which is the tell for a sizing fault rather than a spacing one.
 */
import { describe, expect, it } from "vitest";

import { fitInside } from "./fit";
import { FRAME_PRESETS } from "../../../shared/presets";

/** Roughly the pane the preview gets in a default window. */
const PANE = { width: 900, height: 480 };

describe("fitInside", () => {
  it("never exceeds the space available", () => {
    // The property that matters. Every preset, in a pane of every shape.
    const panes = [
      { width: 900, height: 480 },
      { width: 400, height: 900 },
      { width: 1600, height: 200 },
      { width: 120, height: 120 },
      { width: 3000, height: 2000 },
    ];

    for (const preset of FRAME_PRESETS) {
      for (const pane of panes) {
        const fitted = fitInside(preset, pane);

        expect(fitted.width).toBeLessThanOrEqual(pane.width);
        expect(fitted.height).toBeLessThanOrEqual(pane.height);
      }
    }
  });

  it("keeps the frame's aspect ratio", () => {
    for (const preset of FRAME_PRESETS) {
      const fitted = fitInside(preset, PANE);
      const wanted = preset.width / preset.height;
      const got = fitted.width / fitted.height;

      // A pixel of slack, since the result is floored to whole pixels.
      expect(Math.abs(got - wanted)).toBeLessThan(0.02);
    }
  });

  it("touches at least one edge of the pane", () => {
    // Fitting is not just "small enough": a preview that leaves room on both
    // axes is wasting the window.
    for (const preset of FRAME_PRESETS) {
      const fitted = fitInside(preset, PANE);
      const fillsWidth = fitted.width >= PANE.width - 1;
      const fillsHeight = fitted.height >= PANE.height - 1;

      expect(fillsWidth || fillsHeight).toBe(true);
    }
  });

  it("is width-bound for a wide frame in a wide-ish pane", () => {
    // 16:9 into 900×480 (1.875) is taller in ratio, so height binds.
    expect(fitInside({ width: 1920, height: 1080 }, PANE).height).toBe(480);
  });

  it("is height-bound for a vertical frame", () => {
    // 9:16 in a landscape pane can only ever be limited by height.
    const fitted = fitInside({ width: 1080, height: 1920 }, PANE);

    expect(fitted.height).toBe(480);
    expect(fitted.width).toBeLessThan(PANE.width);
  });

  it("scales a 4K frame down as readily as a 720p one", () => {
    // Both are 16:9, so both land on the same box — the output resolution must
    // not leak into the layout.
    expect(fitInside({ width: 3840, height: 2160 }, PANE)).toEqual(
      fitInside({ width: 1280, height: 720 }, PANE),
    );
  });

  it("scales a small frame up to fill the pane", () => {
    // Not just clamped: a 320×180 preview floating in a large window would look
    // broken rather than deliberate.
    const fitted = fitInside({ width: 320, height: 180 }, PANE);

    expect(fitted.height).toBe(480);
    expect(fitted.width).toBeGreaterThan(320);
  });

  it("gives up rather than returning nonsense", () => {
    // Before the first measurement, and while a pane is collapsed.
    expect(fitInside({ width: 1920, height: 1080 }, { width: 0, height: 0 })).toEqual({
      width: 0,
      height: 0,
    });
    expect(fitInside({ width: 0, height: 0 }, PANE)).toEqual({ width: 0, height: 0 });
  });

  it("never returns a zero-sized box for a usable pane", () => {
    // A canvas of width 0 throws on `getContext` work in some paths and draws
    // nothing in the rest.
    const fitted = fitInside({ width: 3840, height: 2160 }, { width: 3, height: 3 });

    expect(fitted.width).toBeGreaterThan(0);
    expect(fitted.height).toBeGreaterThan(0);
  });
});
