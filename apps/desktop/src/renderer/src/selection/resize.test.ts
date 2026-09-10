/**
 * What a dragged region does at its limits.
 *
 * The ordinary cases are visible the moment anyone uses the overlay. These are
 * the ones nobody drags to on purpose and everybody eventually does: a corner
 * pulled through its opposite, an edge shoved off the side of the display, a
 * region pushed into a corner and then along it.
 */
import { describe, expect, it } from "vitest";

import { moved, resized } from "./resize";

const SCREEN = { width: 1000, height: 800 };
const RECT = { x: 100, y: 100, width: 200, height: 200 };

describe("resizing by a grip", () => {
  it("moves only the edges its grip owns", () => {
    // A north handle is the test: an implementation that treats every grip as a
    // corner drags the sides in with it.
    const next = resized(RECT, "n", { x: 999, y: 40 }, SCREEN);

    expect(next).toEqual({ x: 100, y: 40, width: 200, height: 260 });
  });

  it("takes both edges from a corner", () => {
    const next = resized(RECT, "se", { x: 400, y: 500 }, SCREEN);

    expect(next).toEqual({ x: 100, y: 100, width: 300, height: 400 });
  });

  it("flips rather than collapsing when a corner is pulled through its opposite", () => {
    // Dragging the south-east corner up and left past the north-west one. The
    // region should carry on being drawn on the other side, which is what every
    // other drawing tool does; clamping at zero instead sticks the drag.
    const next = resized(RECT, "se", { x: 40, y: 30 }, SCREEN);

    expect(next).toEqual({ x: 40, y: 30, width: 60, height: 70 });
  });

  it("stays on the display", () => {
    const next = resized(RECT, "se", { x: 5000, y: 5000 }, SCREEN);

    expect(next.x + next.width).toBe(SCREEN.width);
    expect(next.y + next.height).toBe(SCREEN.height);
  });

  it("stays on the display in the other direction too", () => {
    const next = resized(RECT, "nw", { x: -500, y: -500 }, SCREEN);

    expect(next).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });
});

describe("moving the whole region", () => {
  it("slides by the delta", () => {
    expect(moved(RECT, { x: 50, y: -30 }, SCREEN)).toEqual({
      x: 150,
      y: 70,
      width: 200,
      height: 200,
    });
  });

  it("keeps its size when it meets an edge", () => {
    // A move that shrank the region against the side of the display would be a
    // resize nobody asked for.
    const next = moved(RECT, { x: 5000, y: 0 }, SCREEN);

    expect(next.width).toBe(RECT.width);
    expect(next.x).toBe(SCREEN.width - RECT.width);
  });

  it("still slides along an edge it is pressed against", () => {
    // Pushed into the top and dragged sideways. Stopping both axes because one
    // ran out is what makes a drag feel caught on something.
    const next = moved({ ...RECT, y: 0 }, { x: 60, y: -40 }, SCREEN);

    expect(next.y).toBe(0);
    expect(next.x).toBe(160);
  });

  it("copes with a region larger than the display", () => {
    // Not reachable by drawing, but a resize can leave one exactly the size of
    // the screen, and the clamp must not invert.
    const whole = { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height };

    expect(moved(whole, { x: 25, y: 25 }, SCREEN)).toEqual(whole);
  });
});
