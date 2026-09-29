import { TELEPROMPTER_MAX_LINES, TELEPROMPTER_MIN_LINES } from "../../../shared/contract";

/**
 * How many lines a drag of the island's handle has asked for.
 *
 * Apart from the component because it is the whole of what the gesture means,
 * and a sign or a divisor the wrong way round here is invisible until somebody
 * drags: the handle would shorten the panel as the hand went down, or move it
 * by a line per pixel.
 *
 * `moved` is how far the pointer has travelled from where it was pressed, in
 * CSS pixels, positive downwards — so down is taller, the way every resize
 * handle in every window works. Rounded to whole lines because a line is the
 * unit the reader gets; a height between two of them shows a band of a line
 * sliced off at the fade.
 */
export function linesFromDrag(from: number, moved: number, lineHeight: number): number {
  // A line height of zero would be a text size of zero, which cannot happen —
  // but dividing by it would make every drag `NaN`, and `NaN` clamps to `NaN`,
  // which is a height the island would never come back from.
  if (!(lineHeight > 0)) return clampLines(from);
  return clampLines(from + Math.round(moved / lineHeight));
}

/** Keeps a line count inside what the island can draw and the window can hold. */
export function clampLines(lines: number): number {
  if (!Number.isFinite(lines)) return TELEPROMPTER_MIN_LINES;
  return Math.min(Math.max(Math.round(lines), TELEPROMPTER_MIN_LINES), TELEPROMPTER_MAX_LINES);
}
