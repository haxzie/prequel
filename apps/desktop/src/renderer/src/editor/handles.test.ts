import { describe, expect, it } from "vitest";

import {
  cornerAt,
  handleAt,
  keepsAspect,
  pulled,
  radiusAt,
  radiusDot,
  radiusFrom,
  radiusInset,
  type Handle,
} from "./handles";

/** 200 × 100, so a held ratio is obvious in the numbers rather than inferred. */
const BOX = { x: 100, y: 50, width: 200, height: 100 };

const ratio = (box: { width: number; height: number }) => box.width / box.height;

describe("which handle keeps the ratio", () => {
  it("holds it on a corner whether or not Shift is down", () => {
    for (const corner of ["nw", "ne", "se", "sw"] as const) {
      expect(keepsAspect(corner, false)).toBe(true);
      expect(keepsAspect(corner, true)).toBe(true);
    }
  });

  it("lets an edge go free until Shift is down", () => {
    for (const edge of ["n", "e", "s", "w"] as const) {
      expect(keepsAspect(edge, false)).toBe(false);
      expect(keepsAspect(edge, true)).toBe(true);
    }
  });
});

describe("pulling a handle", () => {
  it("leaves the opposite corner exactly where it was", () => {
    const anchors: Record<string, { x: number; y: number }> = {
      nw: { x: 300, y: 150 },
      ne: { x: 100, y: 150 },
      se: { x: 100, y: 50 },
      sw: { x: 300, y: 50 },
    };

    for (const [corner, anchor] of Object.entries(anchors)) {
      const box = pulled(BOX, corner as Handle, { x: 500, y: 400 }, true);
      // Whichever corner of the result is the anchor, it is unmoved.
      expect([box.x, box.x + box.width]).toContain(anchor.x);
      expect([box.y, box.y + box.height]).toContain(anchor.y);
    }
  });

  it("keeps the picture's ratio on a corner, not the drag's", () => {
    // A pointer miles off the diagonal: a box that took the drag's ratio would
    // come back nearly square.
    const box = pulled(BOX, "se", { x: 900, y: 160 }, true);
    expect(ratio(box)).toBeCloseTo(ratio(BOX), 6);
  });

  it("moves one edge and leaves the other axis alone", () => {
    const east = pulled(BOX, "e", { x: 500, y: 999 }, false);
    expect(east).toEqual({ x: 100, y: 50, width: 400, height: 100 });

    const north = pulled(BOX, "n", { x: 999, y: 0 }, false);
    expect(north).toEqual({ x: 100, y: 0, width: 200, height: 150 });
  });

  it("drives the other axis from the dragged one when Shift is held", () => {
    const east = pulled(BOX, "e", { x: 500, y: 999 }, true);
    expect(east.width).toBe(400);
    expect(ratio(east)).toBeCloseTo(ratio(BOX), 6);

    const south = pulled(BOX, "s", { x: 999, y: 250 }, true);
    expect(south.height).toBe(200);
    expect(ratio(south)).toBeCloseTo(ratio(BOX), 6);
  });

  it("grows the free axis about its own middle under Shift", () => {
    // Otherwise the picture swings sideways as it scales: nothing is dragging
    // that axis, so neither of its edges has a claim to stay put.
    const was = BOX.y + BOX.height / 2;
    const box = pulled(BOX, "e", { x: 500, y: 0 }, true);
    expect(box.y + box.height / 2).toBeCloseTo(was, 6);
    expect(box.x).toBe(BOX.x);
  });

  it("never collapses to nothing, however far the pointer crosses over", () => {
    for (const handle of ["nw", "ne", "se", "sw", "n", "e", "s", "w"] as const) {
      const box = pulled(BOX, handle, { x: 200, y: 100 }, false);
      expect(box.width).toBeGreaterThanOrEqual(1);
      expect(box.height).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("finding a handle under the pointer", () => {
  it("answers with a corner where a corner and an edge both reach", () => {
    // The top-left corner is also the left end of the north edge.
    expect(handleAt(BOX, { x: 100, y: 50 }, 12, true)).toBe("nw");
  });

  it("answers with an edge only around its midpoint", () => {
    expect(handleAt(BOX, { x: 200, y: 50 }, 12, true)).toBe("n");
    // A quarter along the same edge is the picture's body, not a handle: a
    // strip running the whole edge would make the thing hard to pick up.
    expect(handleAt(BOX, { x: 150, y: 50 }, 12, true)).toBeNull();
  });

  it("offers no edge at all when the caller does not want them", () => {
    expect(handleAt(BOX, { x: 200, y: 50 }, 12, false)).toBeNull();
    expect(handleAt(BOX, { x: 100, y: 50 }, 12, false)).toBe("nw");
  });

  it("keeps the handles off each other on a small picture", () => {
    // A bubble a few tolerances across: four corners at full reach would cover
    // the whole of it and it could never be dragged.
    const small = { x: 0, y: 0, width: 24, height: 24 };
    expect(cornerAt(small, { x: 12, y: 12 }, 12)).toBeNull();
    expect(handleAt(small, { x: 12, y: 12 }, 12, true)).toBeNull();
  });
});

describe("the radius dot", () => {
  const box = { x: 100, y: 50, width: 400, height: 200 };

  it("sits at the radius, in from each corner", () => {
    expect(radiusDot(box, "nw", 40, 10)).toEqual({ x: 140, y: 90 });
    expect(radiusDot(box, "se", 40, 10)).toEqual({ x: 460, y: 210 });
  });

  it("is held off a square corner, where the resize handle is", () => {
    // At a radius of zero the dot would sit on the corner, under the handle
    // that resizes the picture — so the only gesture that could reach it
    // would be the other one.
    expect(radiusDot(box, "nw", 0, 12)).toEqual({ x: 112, y: 62 });
  });

  it("stops at the roundest a rectangle goes", () => {
    // Half the shorter edge. Past it the arcs meet and more radius is a
    // number that changes no pixels.
    expect(radiusInset(box, 500, 12)).toBe(100);
  });

  it("answers a pull on its own corner and not on its neighbour's", () => {
    const dot = radiusDot(box, "ne", 30, 12);

    expect(radiusAt(box, dot, 8, 30, 12)).toBe("ne");
    expect(radiusAt(box, { x: dot.x + 40, y: dot.y }, 8, 30, 12)).toBeNull();
  });

  it("reads a diagonal pull as the distance it came in", () => {
    expect(radiusFrom(box, "nw", { x: 130, y: 80 })).toBe(30);
    expect(radiusFrom(box, "se", { x: 470, y: 220 })).toBe(30);
  });

  it("goes on answering a drag that leaves the diagonal", () => {
    // Straight across from the corner: the mean of the two axes still moves,
    // where a distance along the diagonal would stop following the pointer.
    expect(radiusFrom(box, "nw", { x: 160, y: 50 })).toBe(30);
  });

  it("never asks for a radius a rectangle cannot hold", () => {
    expect(radiusFrom(box, "nw", { x: 100 + 400, y: 50 + 200 })).toBe(100);
    expect(radiusFrom(box, "nw", { x: 50, y: 0 })).toBe(0);
  });
});
