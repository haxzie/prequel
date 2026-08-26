/**
 * That the picture of an angle agrees with the angle.
 *
 * The perspective pad exists so nobody has to guess what −8° of pitch looks
 * like, and it earns that only while its plate leans the way the export will.
 * It did not: the transform negated the pitch, so every preset drew the
 * opposite of what it set, and the control that was there to be trusted was the
 * one thing lying. Nothing caught it because both pictures are convincing —
 * a plate leaning the wrong way is still a plausible plate.
 *
 * So the assertions here are against `rectAt`'s real corners rather than
 * against a second copy of the maths. A test that re-derived the projection
 * would agree with a mistake as happily as with the truth.
 */
import { describe, expect, it } from "vitest";

import { buildRenderPlan, rectAt } from "../../../../shared/layout.js";
import { DEFAULT_SETTINGS, DEFAULT_ZOOM } from "../../../../shared/project.js";
import { plateTransform, shadingAngle, shadingStrength } from "./perspective.js";

/** Times on the plan are nanoseconds. */
const S = 1_000_000_000;

/**
 * The four projected corners, each with how far away it is.
 *
 * `rotatedQuad` stores `depth / distance` as every corner's third number — the
 * divisor a GPU applies, so larger is farther. That is the only fact these
 * tests need from the renderer, and reading it out of a real plan rather than
 * recomputing it is the whole point of the exercise.
 */
function corners(rotateX: number, rotateY: number) {
  const plan = buildRenderPlan(
    { width: 1920, height: 1080 },
    { screen: { width: 2560, height: 1440 }, camera: null },
    structuredClone(DEFAULT_SETTINGS),
    null,
    [
      {
        // Spread first so a field added to a zoom later cannot break this
        // fixture; every value spelled out below still wins over the default.
        ...DEFAULT_ZOOM,
        id: "z",
        source: { start: 0, end: 4 * S },
        target: "region",
        x: 0.5,
        y: 0.5,
        level: 1.5,
        speed: 0,
        rotateX,
        rotateY,
      },
    ],
  );

  const item = plan.items.find(
    (candidate) => candidate.kind === "image" && candidate.source === "screen",
  );
  if (item?.kind !== "image") throw new Error("expected a screen image");

  // Halfway through, where the zoom is fully arrived and the eased `amount`
  // is not scaling the angle down towards nothing.
  const quad = rectAt(item.motion ?? [], 2 * S, item.dstRect, item.shape.radius).quad;
  if (!quad) throw new Error("expected a tilted quad");

  // Top-left, top-right, bottom-left, bottom-right — the order the vertex id
  // walks a triangle strip.
  return {
    topLeft: { x: quad[0]!, y: quad[1]!, far: quad[2]! },
    topRight: { x: quad[3]!, y: quad[4]!, far: quad[5]! },
    bottomLeft: { x: quad[6]!, y: quad[7]!, far: quad[8]! },
    bottomRight: { x: quad[9]!, y: quad[10]!, far: quad[11]! },
  };
}

/**
 * Where the shading puts its dark end, as a unit vector with y measured up.
 *
 * CSS gradient angles run clockwise from "to top", so this is the inverse of
 * the conversion the component relies on — if either drifts, the directions
 * below stop lining up with the corners.
 */
function darkTowards(rotateX: number, rotateY: number) {
  const radians = (shadingAngle(rotateX, rotateY) * Math.PI) / 180;
  return { x: Math.sin(radians), up: Math.cos(radians) };
}

describe("the shading on a plate", () => {
  it("darkens the edge the renderer puts farthest away", () => {
    // Pitch and yaw separately, then together, and in both directions: an
    // inverted sign survives any single case that happens to be symmetrical.
    const cases = [
      { rotateX: 8, rotateY: 0 },
      { rotateX: -8, rotateY: 0 },
      { rotateX: 0, rotateY: 10 },
      { rotateX: 0, rotateY: -10 },
      { rotateX: 12, rotateY: -14 },
      { rotateX: -12, rotateY: 14 },
    ];

    for (const { rotateX, rotateY } of cases) {
      const quad = corners(rotateX, rotateY);
      const dark = darkTowards(rotateX, rotateY);

      // Vertical: which of the two edges is farther, and does the gradient
      // lean that way? `up` is positive when the dark end is at the top.
      const topFar = (quad.topLeft.far + quad.topRight.far) / 2;
      const bottomFar = (quad.bottomLeft.far + quad.bottomRight.far) / 2;
      if (Math.abs(topFar - bottomFar) > 1e-6) {
        expect(
          Math.sign(dark.up),
          `rotateX ${String(rotateX)} rotateY ${String(rotateY)} vertical`,
        ).toBe(Math.sign(topFar - bottomFar));
      }

      // Horizontal, the same way round.
      const leftFar = (quad.topLeft.far + quad.bottomLeft.far) / 2;
      const rightFar = (quad.topRight.far + quad.bottomRight.far) / 2;
      if (Math.abs(leftFar - rightFar) > 1e-6) {
        expect(
          Math.sign(dark.x),
          `rotateX ${String(rotateX)} rotateY ${String(rotateY)} horizontal`,
        ).toBe(Math.sign(rightFar - leftFar));
      }
    }
  });

  it("leans the plate the way the renderer leans it", () => {
    // The regression this file exists for, and it needs its own assertion:
    // `shadingAngle` never reads the transform, so shading alone would go on
    // passing with the pitch negated — the gradient would simply be painted on
    // a plate facing the other way.
    //
    // The one CSS fact being pinned: with Y pointing down and +Z at the viewer,
    // `rotateX(+a)` sends the top edge away. So whenever the renderer puts the
    // top farther, the rotation has to be positive.
    for (const { rotateX, rotateY } of [
      { rotateX: 8, rotateY: 0 },
      { rotateX: -8, rotateY: 0 },
      { rotateX: 12, rotateY: -14 },
      { rotateX: -12, rotateY: 14 },
    ]) {
      const quad = corners(rotateX, rotateY);
      const topFar = (quad.topLeft.far + quad.topRight.far) / 2;
      const bottomFar = (quad.bottomLeft.far + quad.bottomRight.far) / 2;

      const drawnX = /rotateX\((-?[\d.]+)deg\)/.exec(plateTransform(rotateX, rotateY))?.[1];
      expect(drawnX, "the transform names a pitch").toBeDefined();

      expect(
        Math.sign(Number(drawnX)),
        `rotateX ${String(rotateX)} rotateY ${String(rotateY)}`,
      ).toBe(Math.sign(topFar - bottomFar));
    }
  });

  it("turns the plate the way the renderer turns it", () => {
    // Yaw was never wrong, which is exactly why it is worth pinning: the fix to
    // the pitch sign was a one-character change to the same template string.
    for (const { rotateX, rotateY } of [
      { rotateX: 0, rotateY: 10 },
      { rotateX: 0, rotateY: -10 },
      { rotateX: 12, rotateY: -14 },
    ]) {
      const quad = corners(rotateX, rotateY);
      const leftFar = (quad.topLeft.far + quad.bottomLeft.far) / 2;
      const rightFar = (quad.topRight.far + quad.bottomRight.far) / 2;

      // `rotateY(+b)` sends the right edge away, the mirror of the rule above.
      const drawnY = /rotateY\((-?[\d.]+)deg\)/.exec(plateTransform(rotateX, rotateY))?.[1];
      expect(
        Math.sign(Number(drawnY)),
        `rotateX ${String(rotateX)} rotateY ${String(rotateY)}`,
      ).toBe(Math.sign(rightFar - leftFar));
    }
  });

  it("has no direction to point when the plate is flat", () => {
    // `atan2(0, 0)` is a confident zero, so it is the strength that has to
    // collapse — otherwise a level plate wears a gradient pointing upwards for
    // no reason anybody could explain.
    expect(shadingStrength(0, 0)).toBe(0);
  });

  it("grows with the lean and then stops", () => {
    // Clamped so a 30° setting is not four times as dark as the 8° one anybody
    // actually uses — past the cap the cue is made, and more only crushes the
    // picture the plate is supposed to be showing.
    expect(shadingStrength(4, 0)).toBeGreaterThan(shadingStrength(2, 0));
    expect(shadingStrength(14, 0)).toBe(1);
    expect(shadingStrength(30, 0)).toBe(1);
  });
});
