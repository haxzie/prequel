import { describe, expect, it } from "vitest";

import {
  angleFrom,
  cornerAt,
  handleAt,
  keepsAspect,
  middleOf,
  normaliseAngle,
  pulled,
  radiusAt,
  radiusDot,
  radiusFrom,
  radiusInset,
  rotateCornerAt,
  snapAngle,
  spin,
  type Handle,
  unspun,
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

describe("turning a picture", () => {
  it("spins clockwise on screen, where y runs down", () => {
    // A point directly above the middle, turned a quarter turn, lands directly
    // to the right of it. The opposite sign is the easy mistake and it is
    // invisible in a screenshot of a square bubble.
    const middle = middleOf(BOX);
    const above = { x: middle.x, y: middle.y - 50 };
    const turned = spin(above, middle, 90);

    expect(turned.x).toBeCloseTo(middle.x + 50, 6);
    expect(turned.y).toBeCloseTo(middle.y, 6);
  });

  it("brings a pointer back to where it would be on an upright box", () => {
    // The whole of what makes `pulled` and the radius dots go on working: a
    // point on the turned picture, unspun, is the point on the picture.
    const corner = { x: BOX.x, y: BOX.y };
    const drawn = spin(corner, middleOf(BOX), 37);
    const back = unspun(drawn, BOX, 37);

    expect(back.x).toBeCloseTo(corner.x, 6);
    expect(back.y).toBeCloseTo(corner.y, 6);
  });

  it("reads an angle from straight up, clockwise", () => {
    const middle = middleOf(BOX);

    expect(angleFrom(BOX, { x: middle.x, y: middle.y - 80 })).toBeCloseTo(0, 6);
    expect(angleFrom(BOX, { x: middle.x + 80, y: middle.y })).toBeCloseTo(90, 6);
    expect(angleFrom(BOX, { x: middle.x, y: middle.y + 80 })).toBeCloseTo(180, 6);
    expect(angleFrom(BOX, { x: middle.x - 80, y: middle.y })).toBeCloseTo(-90, 6);
  });

  it("gives one number for one angle, however far round the drag went", () => {
    // Two turns and a bit is a bit. Left to run, a bubble nudged round twice
    // reads as 730 degrees in a panel and nowhere near straight.
    expect(normaliseAngle(730)).toBeCloseTo(10, 6);
    expect(normaliseAngle(-190)).toBeCloseTo(170, 6);
    // The seam: a half turn is 180 and never -180, so the two never flicker.
    expect(normaliseAngle(180)).toBe(180);
    expect(normaliseAngle(-180)).toBe(180);
  });

  it("snaps only while Shift is held, and lands on the straight angles", () => {
    expect(snapAngle(7, false)).toBe(7);
    expect(snapAngle(7, true)).toBe(0);
    expect(snapAngle(88, true)).toBe(90);
    // A hair past the half turn comes back as the half turn rather than as the
    // same angle with the other sign.
    expect(snapAngle(-178, true)).toBe(180);
  });

  it("turns from the air just outside a corner", () => {
    // 12 out diagonally from the top left: past the handle, inside the reach.
    expect(rotateCornerAt(BOX, { x: BOX.x - 12, y: BOX.y - 12 }, 10, 26, 0)).toBe("nw");
    expect(
      rotateCornerAt(BOX, { x: BOX.x + BOX.width + 9, y: BOX.y + BOX.height + 9 }, 10, 26, 0),
    ).toBe("se");
  });

  it("leaves the corner handle and the inside of the box alone", () => {
    // On the corner is a resize, and `handleAt` answers first — so the zone
    // has to be silent there or the two would both claim the same press.
    const corner = { x: BOX.x, y: BOX.y };
    expect(rotateCornerAt(BOX, corner, 10, 26, 0)).toBe(null);
    expect(rotateCornerAt(BOX, { x: BOX.x + 6, y: BOX.y + 6 }, 10, 26, 0)).toBe(null);
    expect(handleAt(BOX, corner, 10, true)).toBe("nw");
  });

  it("does not answer beside an edge, only beyond a corner", () => {
    // Level with the box on one axis is the air outside an edge, which is
    // where a body drag of whatever is behind it has to stay reachable.
    expect(rotateCornerAt(BOX, { x: BOX.x + BOX.width / 2, y: BOX.y - 12 }, 10, 26, 0)).toBe(null);
    expect(rotateCornerAt(BOX, { x: BOX.x - 12, y: BOX.y + BOX.height / 2 }, 10, 26, 0)).toBe(null);
  });

  it("stops at the reach", () => {
    expect(rotateCornerAt(BOX, { x: BOX.x - 40, y: BOX.y - 40 }, 10, 26, 0)).toBe(null);
  });

  it("travels with a turned picture", () => {
    // The zone is measured with the rotation undone, so it is off the corner
    // wherever that corner has got to — not where an upright box would have it.
    const outside = { x: BOX.x - 12, y: BOX.y - 12 };
    const carried = spin(outside, middleOf(BOX), 90);

    expect(rotateCornerAt(BOX, outside, 10, 26, 90)).toBe(null);
    expect(rotateCornerAt(BOX, carried, 10, 26, 90)).toBe("nw");
  });
});
