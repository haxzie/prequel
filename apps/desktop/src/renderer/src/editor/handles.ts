/**
 * The eight handles on a selected thing in the preview, and the geometry of
 * pulling one.
 *
 * Apart from `Preview` for the reason `selection/resize.ts` is apart from the
 * overlay it serves: this is arithmetic with no canvas and no React in it, and
 * it is the half that can be wrong in ways nothing on screen announces. A box
 * that drifts a pixel per frame, or an aspect lock that holds the ratio of the
 * drag rather than of the picture, both look plausible while they happen.
 */
import type { Rect } from "../../../shared/layout";

/** A point in the output frame, in its own pixels. */
export interface Point {
  x: number;
  y: number;
}

export type Corner = "nw" | "ne" | "sw" | "se";

/** The middle of one edge. Moves that edge alone, leaving the other axis. */
export type Edge = "n" | "e" | "s" | "w";

export type Handle = Corner | Edge;

/**
 * Which of the two a handle is.
 *
 * By length, because the names are built to allow it: a corner names both of
 * the edges it joins and an edge names itself. A lookup table would be a
 * second place to add a handle to.
 */
export function isCorner(handle: Handle): handle is Corner {
  return handle.length === 2;
}

/**
 * Whether this drag holds the picture's proportions.
 *
 * Corners always do: pulling one is a statement about how big the thing should
 * be, not what shape — and the four edges are there for the times the shape is
 * the point. Shift is the override on those, and does nothing on a corner,
 * which keeps one rule rather than two: Shift means "keep the ratio", and a
 * corner is keeping it already.
 */
export function keepsAspect(handle: Handle, shift: boolean): boolean {
  return isCorner(handle) || shift;
}

/**
 * Which corner the pointer is on, if any.
 *
 * The tolerance reaches inwards as well as outwards, so a corner is grabbable
 * on a picture that runs to the edge of the frame and has no outside to speak
 * of. It also has to stay smaller than the picture: on a bubble a few
 * tolerances across, four handles would cover the whole thing and it could
 * never be dragged.
 */
export function cornerAt(rect: Rect, point: Point, near: number): Corner | null {
  const reach = Math.min(near, rect.width / 3, rect.height / 3);
  const west = Math.abs(point.x - rect.x) <= reach;
  const east = Math.abs(point.x - (rect.x + rect.width)) <= reach;
  const north = Math.abs(point.y - rect.y) <= reach;
  const south = Math.abs(point.y - (rect.y + rect.height)) <= reach;

  if (north && west) return "nw";
  if (north && east) return "ne";
  if (south && west) return "sw";
  if (south && east) return "se";
  return null;
}

/**
 * Which handle the pointer is on, if any.
 *
 * Corners first: they sit at the ends of the edges the side handles run along,
 * and on a small picture the two tolerances meet. A corner is the more useful
 * answer where they do, because it is the one that can move both axes.
 *
 * An edge answers only around its midpoint, not along its whole length. The
 * handle drawn there is 8px and the slack around it is a few more; a strip
 * running the length of the edge would swallow the body drag everywhere near
 * the border, and a picture would become hard to pick up rather than easy to
 * resize.
 */
export function handleAt(rect: Rect, point: Point, near: number, edges: boolean): Handle | null {
  const corner = cornerAt(rect, point, near);
  if (corner || !edges) return corner;

  const reach = Math.min(near, rect.width / 3, rect.height / 3);
  const atMidX = Math.abs(point.x - (rect.x + rect.width / 2)) <= reach;
  const atMidY = Math.abs(point.y - (rect.y + rect.height / 2)) <= reach;

  if (atMidX && Math.abs(point.y - rect.y) <= reach) return "n";
  if (atMidX && Math.abs(point.y - (rect.y + rect.height)) <= reach) return "s";
  if (atMidY && Math.abs(point.x - rect.x) <= reach) return "w";
  if (atMidY && Math.abs(point.x - (rect.x + rect.width)) <= reach) return "e";
  return null;
}

export function pulled(rect: Rect, handle: Handle, point: Point, keepAspect: boolean): Rect {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  // Which edges this handle moves. An edge handle moves one; a corner moves
  // two; the ones it does not move are the anchor and stay exactly where they
  // were, which is what makes a resize feel like dragging an edge rather than
  // scaling about a centre.
  const west = handle === "nw" || handle === "sw" || handle === "w";
  const east = handle === "ne" || handle === "se" || handle === "e";
  const north = handle === "nw" || handle === "ne" || handle === "n";
  const south = handle === "sw" || handle === "se" || handle === "s";

  // Kept a pixel across at worst: a box collapsed to nothing has no handles
  // left to grab and could never be recovered.
  let width = west
    ? Math.max(1, right - point.x)
    : east
      ? Math.max(1, point.x - rect.x)
      : rect.width;
  let height = north
    ? Math.max(1, bottom - point.y)
    : south
      ? Math.max(1, point.y - rect.y)
      : rect.height;

  if (keepAspect && isCorner(handle)) {
    // The larger of the two, so the picture follows the pointer outwards rather
    // than being held back by whichever edge moved less.
    const scale = Math.max(width / rect.width, height / rect.height);
    width = rect.width * scale;
    height = rect.height * scale;
  } else if (keepAspect) {
    // One axis is being dragged and the other has to follow it. Which is which
    // is the handle: a side handle drives the width, a top or bottom one the
    // height.
    const ratio = rect.height / Math.max(rect.width, 1);
    if (west || east) height = Math.max(1, width * ratio);
    else width = Math.max(1, height / Math.max(ratio, Number.EPSILON));
  }

  // The axis the handle does not move. It holds its coordinate normally — but
  // under Shift the free axis has just changed size with no edge of its own
  // driving it, and growing it off one side would swing the picture sideways
  // as it scaled. Centred, it grows evenly about where it was.
  const loose = keepAspect && !isCorner(handle);

  return {
    x: west ? right - width : east ? rect.x : loose ? rect.x + (rect.width - width) / 2 : rect.x,
    y: north
      ? bottom - height
      : south
        ? rect.y
        : loose
          ? rect.y + (rect.height - height) / 2
          : rect.y,
    width,
    height,
  };
}

/**
 * How far in from a corner the radius dot sits, in output pixels.
 *
 * The radius itself, held away from the corner by a floor and in from the
 * middle by a ceiling.
 *
 * The floor is what makes a square corner adjustable at all: at a radius of
 * zero the dot would sit exactly on the corner, under the handle that resizes
 * the picture — so the one gesture that reaches it would be the other one. The
 * ceiling is half the shorter edge, which is the roundest a rectangle goes:
 * past it the arcs meet and more radius changes nothing.
 */
export function radiusInset(rect: Rect, radius: number, least: number): number {
  const most = Math.min(rect.width, rect.height) / 2;
  return Math.min(Math.max(radius, least), Math.max(most, least));
}

/** Where the dot for one corner is, in output pixels. */
export function radiusDot(rect: Rect, corner: Corner, radius: number, least: number): Point {
  const inset = radiusInset(rect, radius, least);
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";

  return {
    x: west ? rect.x + inset : rect.x + rect.width - inset,
    y: north ? rect.y + inset : rect.y + rect.height - inset,
  };
}

/**
 * Which radius dot the pointer is on, if any.
 *
 * Every corner carries one and all four set the same number — there is one
 * radius per picture, not four. Four dots rather than one because a corner is
 * reached for by where it is: somebody rounding the bottom of a bubble should
 * not have to go to the top left to do it.
 */
export function radiusAt(
  rect: Rect,
  point: Point,
  near: number,
  radius: number,
  least: number,
): Corner | null {
  for (const corner of ["nw", "ne", "se", "sw"] as const) {
    const dot = radiusDot(rect, corner, radius, least);
    if (Math.abs(point.x - dot.x) <= near && Math.abs(point.y - dot.y) <= near) return corner;
  }
  return null;
}

/**
 * The radius a pointer at this position is asking for, in output pixels.
 *
 * The mean of how far in it has come on each axis, rather than its distance
 * along the diagonal. They agree on a diagonal drag, which is how the dot is
 * usually pulled; where they differ is a drag straight down or straight
 * across, and the mean goes on answering there — the distance would have the
 * dot stop following the pointer the moment it left the diagonal.
 *
 * Clamped the same way the dot is drawn, so what is under the pointer and what
 * is written cannot disagree at either end.
 */
export function radiusFrom(rect: Rect, corner: Corner, point: Point): number {
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";

  const x = west ? point.x - rect.x : rect.x + rect.width - point.x;
  const y = north ? point.y - rect.y : rect.y + rect.height - point.y;

  const most = Math.min(rect.width, rect.height) / 2;
  return Math.min(Math.max((x + y) / 2, 0), most);
}
