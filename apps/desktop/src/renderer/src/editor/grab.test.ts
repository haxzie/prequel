import { describe, expect, it } from "vitest";

import type { RenderPlan, Rect } from "../../../shared/layout";
import { apertureOf, grabbed, plateFor } from "./grab";

const REST: Rect = { x: 100, y: 50, width: 800, height: 450 };

/** A plan holding one picture, with whatever track the case needs. */
function planWith(motion?: unknown): RenderPlan {
  return {
    frame: { width: 1000, height: 560 },
    items: [
      {
        kind: "image",
        source: "screen",
        srcRect: { x: 0, y: 0, width: 1600, height: 900 },
        dstRect: REST,
        shape: { radius: 0, exponent: 2 },
        mirror: false,
        ...(motion ? { motion } : {}),
      },
    ],
  } as RenderPlan;
}

describe("what a gesture can take hold of", () => {
  it("hands back the resting box on a picture nothing is moving", () => {
    const held = grabbed(planWith(), "screen", 0, null, false)!;

    expect(held.drag).toBe(true);
    expect(held.box).toEqual(REST);
    expect(held.scale).toBe(1);
  });

  it("refuses the drag while a shot is carrying the card", () => {
    // The shot decides where the picture lands, so there is no box for a pull
    // to write — a move would be a gesture the next frame undid.
    const carried = planWith([
      { at: 0, x: 0, y: 0, width: 1000, height: 560, radius: 0 },
      { at: 1_000_000_000, x: 0, y: 0, width: 1000, height: 560, radius: 0 },
    ]);

    expect(grabbed(carried, "screen", 0, null, false)!.drag).toBe(false);
  });

  it("keeps the drag while a shot only moves the window", () => {
    // The card holds still and the shot travels through the recording, so the
    // rectangle on screen is exactly the resting box.
    const window = planWith([
      {
        at: 0,
        ...REST,
        radius: 0,
        src: { x: 200, y: 100, width: 800, height: 450 },
      },
    ]);

    expect(grabbed(window, "screen", 0, null, false)!.drag).toBe(true);
  });

  it("keeps the handles on a picture still arriving from the clip before", () => {
    // The regression this test exists for: cutting a clip and giving the
    // second half a size of its own left it with no handles at all, because
    // selecting a clip parks the playhead at its start — the one stretch of
    // the clip that is still travelling in.
    const travelling = planWith([
      { at: 0, x: 0, y: 0, width: 1000, height: 560, radius: 0 },
      { at: 280_000_000, ...REST, radius: 0 },
    ]);

    // Without the arrival being named as one, this is indistinguishable from
    // a shot carrying the card — which is the shape the bug had.
    expect(grabbed(travelling, "screen", 0, null, false)!.drag).toBe(false);

    const held = grabbed(travelling, "screen", 0, null, true)!;
    expect(held.drag).toBe(true);
    // Ringed where it is going, so a pull writes the box the move ends at
    // rather than one computed from a position the next frame has left.
    expect(held.box).toEqual(REST);
    expect(held.rest).toEqual(REST);
    expect(held.scale).toBe(1);
  });

  it("still refuses a shot's card once the arrival is over", () => {
    const carried = planWith([
      { at: 0, x: 0, y: 0, width: 1000, height: 560, radius: 0 },
      { at: 1_000_000_000, x: 0, y: 0, width: 1000, height: 560, radius: 0 },
    ]);

    expect(grabbed(carried, "screen", 500_000_000, null, false)!.drag).toBe(false);
  });

  it("falls back to the settings' box when the plan has no picture", () => {
    const empty = { frame: { width: 1000, height: 560 }, items: [] } as RenderPlan;

    expect(grabbed(empty, "screen", 0, REST, false)).toEqual({
      box: REST,
      rest: REST,
      scale: 1,
      drag: true,
    });
    expect(grabbed(empty, "screen", 0, null, false)).toBeNull();
  });
});

/**
 * A framed camera: the picture in its hole, and the plate hung round it.
 *
 * The numbers are a polaroid's in miniature — a hole three quarters across the
 * paper with a deep strip under it — so the two boxes are plainly different
 * and an answer that confused them cannot pass.
 */
const HOLE = { x: 0.1, y: 0.1, width: 0.8, height: 0.6 };
const APERTURE: Rect = { x: 140, y: 100, width: 320, height: 240 };
const PLATE: Rect = { x: 100, y: 60, width: 400, height: 400 };

function framedPlan(): RenderPlan {
  return {
    frame: { width: 1000, height: 560 },
    items: [
      {
        kind: "image",
        source: "camera",
        srcRect: { x: 0, y: 0, width: 640, height: 480 },
        dstRect: APERTURE,
        shape: { radius: 0, exponent: 2 },
        mirror: false,
      },
      { kind: "frame", path: "@library/frames/polaroid.png", rect: PLATE },
    ],
  } as RenderPlan;
}

describe("taking hold of a camera in a frame", () => {
  it("is grabbed by the plate, not by the photograph in it", () => {
    // Handles inside a polaroid's paper look like a mistake, and the turn they
    // offer would be about the photograph's middle while the object plainly
    // turns about its own.
    const held = grabbed(framedPlan(), "camera", 0, null, false)!;

    expect(held.box).toEqual(PLATE);
    expect(held.aperture).toEqual(HOLE);
  });

  it("still rests on the picture's own box", () => {
    // The leaves a drag writes are the camera's, and the shrink a zoom applies
    // is anchored on the picture's margins — so `rest` has to stay the
    // picture's whatever `box` is.
    expect(grabbed(framedPlan(), "camera", 0, null, false)!.rest).toEqual(APERTURE);
  });

  it("converts a pulled plate back to the picture it frames", () => {
    const held = grabbed(framedPlan(), "camera", 0, null, false)!;
    const hole = held.aperture!;

    // Unchanged, and then doubled about its own corner: the hole follows the
    // plate through any resize, which is what lets the gesture work in one box
    // and the settings in the other.
    expect(apertureOf(PLATE, hole)).toEqual(APERTURE);
    const bigger = { x: 100, y: 60, width: 800, height: 800 };
    expect(apertureOf(bigger, hole)).toEqual({ x: 180, y: 140, width: 640, height: 480 });

    // And back, which is the pair the move branch uses.
    expect(plateFor(apertureOf(bigger, hole), hole)).toEqual(bigger);
  });

  it("says nothing about a plate on a camera that has none", () => {
    // Every camera before frames existed, and most of them since. The absent
    // field is what makes both conversions the identity.
    const held = grabbed(planWith(), "screen", 0, null, false)!;
    expect(held.aperture).toBeUndefined();
  });
});
