import type { Region } from "../../../shared/contract";

/**
 * Moving and resizing a drawn area.
 *
 * Apart from the overlay because it is arithmetic, and arithmetic about a
 * rectangle the user is dragging is exactly the thing that is unpleasant to
 * check by hand: every case is a pointer position, a handle and an edge, and
 * the ones that go wrong are the ones nobody drags to on purpose — a corner
 * pulled straight through its opposite, an edge shoved past the side of the
 * display.
 */

/** Which grip is under the pointer. `move` is the body of the rectangle. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/** Every grip drawn on a settled area, in the order they are rendered. */
export const HANDLES: readonly Exclude<Handle, "move">[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** The cursor each grip takes, so the overlay does not repeat this table. */
export const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  move: "move",
};

/**
 * Where a grip sits on a rectangle, as a fraction of each edge.
 *
 * One table rather than a switch per use: the overlay places the grips from it
 * and `resized` reads which edges each one moves out of the same names.
 */
const ANCHOR: Record<Exclude<Handle, "move">, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

export function anchorOf(handle: Exclude<Handle, "move">): { x: number; y: number } {
  return ANCHOR[handle];
}

/**
 * The rectangle after dragging one grip to a point.
 *
 * The dragged edges follow the pointer and the others stay put, which is what
 * makes a resize feel attached to the corner rather than to the shape. A
 * pointer taken past the opposite edge flips the rectangle rather than
 * collapsing it — `Math.min`/`Math.max` on the resulting pair — so a corner
 * dragged across the whole area keeps drawing instead of sticking at nothing.
 *
 * Clamped to `bounds` because the overlay covers exactly one display and a
 * region outside it is not something ScreenCaptureKit can crop to.
 */
export function resized(
  rect: Region,
  handle: Exclude<Handle, "move">,
  point: { x: number; y: number },
  bounds: { width: number; height: number },
): Region {
  const anchor = ANCHOR[handle];

  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  const x = clamp(point.x, 0, bounds.width);
  const y = clamp(point.y, 0, bounds.height);

  // Only the edges this grip owns. A north handle leaves left and right alone,
  // which is the whole difference between an edge grip and a corner one.
  const nextLeft = anchor.x === 0 ? x : left;
  const nextRight = anchor.x === 1 ? x : right;
  const nextTop = anchor.y === 0 ? y : top;
  const nextBottom = anchor.y === 1 ? y : bottom;

  return {
    x: Math.min(nextLeft, nextRight),
    y: Math.min(nextTop, nextBottom),
    width: Math.abs(nextRight - nextLeft),
    height: Math.abs(nextBottom - nextTop),
  };
}

/**
 * The rectangle after dragging its body by a delta.
 *
 * Slides along whichever edge it meets rather than stopping dead at the corner:
 * the offset is clamped per axis, so a rectangle pushed into the top of the
 * display still moves sideways. Stopping both axes the moment either one runs
 * out is what makes a drag feel like it has caught on something.
 *
 * The size never changes here. A move that shrank a region against an edge
 * would be a resize nobody asked for, and the size is on screen in the card.
 */
export function moved(
  rect: Region,
  delta: { x: number; y: number },
  bounds: { width: number; height: number },
): Region {
  return {
    ...rect,
    x: clamp(rect.x + delta.x, 0, Math.max(0, bounds.width - rect.width)),
    y: clamp(rect.y + delta.y, 0, Math.max(0, bounds.height - rect.height)),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
