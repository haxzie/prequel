/**
 * The press animation.
 *
 * Two of these are the reason it exists at all. The dip has to be *sampled into
 * the track* — both rasterisers interpolate `scale` linearly between the two
 * points they land between, and the pointer is usually held still while it is
 * clicked, so without added samples the nearest real ones are seconds apart and
 * the whole animation is interpolated straight through. And it has to ride on
 * the `scale` the plan already carries, because that is the one number both
 * rasterisers already multiply the pointer's size by; a field of its own would
 * have to be honoured twice and could be honoured differently.
 */
import { describe, expect, it } from "vitest";

import { buildRenderPlan, pressScale } from "./layout";
import { DEFAULT_SETTINGS } from "./project";

const MS = 1_000_000;
const CLICK_NS = 180 * MS;

describe("pressScale", () => {
  it("is 1 with nothing to animate", () => {
    expect(pressScale(undefined, 0)).toBe(1);
    expect(pressScale([], 0)).toBe(1);
  });

  it("is 1 outside a press", () => {
    // Before it, and after it has finished. A pointer that stayed shrunk would
    // read as the size setting having changed rather than as a click.
    expect(pressScale([1000 * MS], 900 * MS)).toBe(1);
    expect(pressScale([1000 * MS], 1000 * MS + CLICK_NS + 1)).toBe(1);
  });

  it("dips and comes back", () => {
    const at = 1000 * MS;
    const middle = pressScale([at], at + CLICK_NS / 3);

    expect(middle).toBeLessThan(1);
    // Both ends sit at rest, so the dip cannot show up as a step.
    expect(pressScale([at], at)).toBeCloseTo(1, 5);
    expect(pressScale([at], at + CLICK_NS)).toBeCloseTo(1, 5);
  });

  it("comes back more slowly than it goes down", () => {
    // A press is a snap and a release. A symmetric dip reads as a wobble.
    const at = 0;
    const down = pressScale([at], CLICK_NS * 0.15);
    const up = pressScale([at], CLICK_NS * 0.85);

    // A sixth of the way in is already deeper than five sixths of the way out.
    expect(down).toBeLessThan(up);
  });

  it("never doubles up on a double-click", () => {
    // Two presses a few tens of milliseconds apart overlap. Multiplying their
    // dips would make the second visibly deeper than the first, which is the
    // opposite of what happened.
    const first = 0;
    const second = 60 * MS;
    const overlapped = pressScale([first, second], 60 * MS);
    const alone = pressScale([second], 60 * MS);

    expect(overlapped).toBeGreaterThanOrEqual(Math.min(alone, pressScale([first], 60 * MS)));
    // And never deeper than one press can go on its own.
    const deepest = Math.min(
      ...Array.from({ length: 64 }, (_, i) => pressScale([first], (CLICK_NS * i) / 63)),
    );
    expect(overlapped).toBeGreaterThanOrEqual(deepest);
  });
});

describe("a press in the plan", () => {
  /** A recording with one pointer sample at each end and a click in between. */
  function planWith(clicks: number[]) {
    const duration = 4_000 * MS;
    return buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: { width: 1920, height: 1080 }, camera: null },
      DEFAULT_SETTINGS,
      {
        // Held still, which is what actually happens while something is being
        // clicked — and is the case the animation has to survive.
        samples: [
          { at: 0, x: 0.5, y: 0.5 },
          { at: duration, x: 0.5, y: 0.5 },
        ],
        clicks,
        shapes: { arrow: { path: "cursor.png", hotspot: { x: 0, y: 0 } } },
        size: 0.035,
        hideAfter: null,
      },
      [],
      null,
    );
  }

  function cursorPoints(plan: ReturnType<typeof planWith>) {
    return plan.items.flatMap((item) => (item.kind === "cursor" ? item.points : []));
  }

  it("writes the dip into the track rather than leaving it to be interpolated", () => {
    // The failure this guards: with only the two real samples, four seconds
    // apart, every frame between them interpolates to a flat scale and the
    // press is never drawn at any size but its own.
    const still = cursorPoints(planWith([]));
    const clicked = cursorPoints(planWith([2_000 * MS]));

    expect(clicked.length).toBeGreaterThan(still.length);
    expect(Math.min(...clicked.map((point) => point.scale))).toBeLessThan(1);
    expect(Math.min(...still.map((point) => point.scale))).toBe(1);
  });

  it("leaves the pointer at rest either side of the press", () => {
    const points = cursorPoints(planWith([2_000 * MS]));
    const outside = points.filter(
      (point) => point.at < 2_000 * MS || point.at > 2_000 * MS + CLICK_NS,
    );

    expect(outside.every((point) => point.scale === 1)).toBe(true);
  });

  it("does not move the pointer to animate it", () => {
    // The dip is a size, not a position. A press that nudged the pointer would
    // point somewhere the click did not land.
    const points = cursorPoints(planWith([2_000 * MS]));
    const xs = new Set(points.map((point) => point.x.toFixed(6)));
    const ys = new Set(points.map((point) => point.y.toFixed(6)));

    expect(xs.size).toBe(1);
    expect(ys.size).toBe(1);
  });
});
