import { describe, expect, it } from "vitest";

import type { RenderPlan, Rect } from "../../../shared/layout";
import { grabbed } from "./grab";

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
