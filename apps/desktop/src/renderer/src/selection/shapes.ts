import type { Region } from "../../../shared/contract";

/**
 * Picking one of the rectangles the app found on screen.
 *
 * Apart from the overlay for the same reason `resize.ts` is: it is a rule about
 * rectangles, and the case that matters is the one that is tedious to produce
 * by hand — a pointer inside four nested shapes at once, where only one of them
 * is the answer.
 */

/**
 * The smallest shape containing the point, or null if none does.
 *
 * Smallest, because a button sits inside a toolbar inside a panel inside a
 * window and all four contain the pointer — but somebody aiming at the button
 * meant the button. Picking the largest, or the first, would make every shape
 * inside another one unreachable.
 *
 * Ties go to the later shape, which keeps the answer stable for a list that
 * arrives largest first: two shapes of the same area are a coin toss either
 * way, and the same coin has to come up the same way on every mouse move or
 * the highlight flickers between them.
 */
export function smallestAt(shapes: readonly Region[], x: number, y: number): Region | null {
  let best: Region | null = null;

  for (const shape of shapes) {
    if (x < shape.x || x > shape.x + shape.width) continue;
    if (y < shape.y || y > shape.y + shape.height) continue;
    if (!best || shape.width * shape.height <= best.width * best.height) best = shape;
  }

  return best;
}

/**
 * Whether two regions are the same one.
 *
 * By value, because the shapes are rebuilt out of IPC on every push: the one
 * the pointer is over after a refresh is a different object from the one it was
 * over before it, and comparing by identity would re-render the overlay on
 * every single mouse move.
 */
export function sameRegion(a: Region | null, b: Region | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
