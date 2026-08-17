/**
 * The zoom easing curve.
 *
 * Two properties matter more than the shape itself. A timing function has to be
 * monotonic — a zoom that doubles back mid-move looks like a bug, not a style —
 * and the default has to reproduce the `smoothstep` it replaced *exactly*, or
 * every project made before the control existed moves differently the next time
 * it is opened.
 */
import { describe, expect, it } from "vitest";

import { easeAt } from "./layout";
import { DEFAULT_ZOOM } from "./project";

const curve = (easeInX: number, easeInY: number, easeOutX: number, easeOutY: number) => ({
  easeInX,
  easeInY,
  easeOutX,
  easeOutY,
});

/** What the easing was before it was a control. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

describe("the default curve", () => {
  it("is the smoothstep it replaced, to within floating point", () => {
    // Not an approximation: at x = 1/3 and 2/3 the bézier's own x(u) reduces to
    // u, so y(x) is 3x² − 2x³. If this ever drifts, every existing project's
    // zooms change the next time they are opened.
    for (let step = 0; step <= 1000; step += 1) {
      const t = step / 1000;
      expect(easeAt(DEFAULT_ZOOM, t)).toBeCloseTo(smoothstep(t), 6);
    }
  });
});

describe("any curve the control can produce", () => {
  const curves = [
    DEFAULT_ZOOM,
    curve(0, 0, 1, 1), // linear
    curve(0.42, 0, 1, 1), // ease-in
    curve(0, 0, 0.58, 1), // ease-out
    curve(1, 0, 0, 1), // both handles fully out: as flat-then-steep as it gets
    curve(0, 0, 0, 1),
    curve(1, 0, 1, 1),
    // Out of range on purpose: the project clamps y to the unit square, so this
    // is what `easeAt` must survive rather than what it will normally be given.
    curve(0.3, -0.5, 0.7, 1.5),
  ];

  it("starts at rest and arrives fully", () => {
    // The ends are what the plan depends on: a curve that did not reach 1 would
    // leave the zoom short of its level for the whole middle of the span.
    for (const shape of curves) {
      expect(easeAt(shape, 0)).toBe(0);
      expect(easeAt(shape, 1)).toBe(1);
    }
  });

  it("never doubles back", () => {
    for (const shape of curves) {
      // Skipped only for the deliberately out-of-range shape above, which the
      // project's clamps make unreachable through the control.
      if (shape.easeInY < 0 || shape.easeOutY > 1) continue;

      let previous = -Infinity;
      for (let step = 0; step <= 200; step += 1) {
        const value = easeAt(shape, step / 200);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });

  it("stays inside the frame's own range", () => {
    // The plan multiplies this by the zoom level. A curve returning wildly out
    // of range would put the picture off the frame, which is the one thing the
    // geometry tests exist to prevent.
    for (const shape of curves) {
      for (let step = 0; step <= 200; step += 1) {
        const value = easeAt(shape, step / 200);
        expect(value).toBeGreaterThan(-1);
        expect(value).toBeLessThan(2);
      }
    }
  });

  it("clamps input rather than extrapolating", () => {
    // `rectFor` can hand it a ratio past the ends when a span is shorter than
    // twice the ease, and extrapolating a bézier there diverges fast.
    for (const shape of curves) {
      expect(easeAt(shape, -5)).toBe(0);
      expect(easeAt(shape, 5)).toBe(1);
    }
  });
});

describe("a linear curve", () => {
  it("is actually a straight line", () => {
    // The clearest check that the x inversion is right: with the control points
    // at the ends, progress and value have to match everywhere.
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 100;
      expect(easeAt(curve(0, 0, 1, 1), t)).toBeCloseTo(t, 5);
    }
  });
});
