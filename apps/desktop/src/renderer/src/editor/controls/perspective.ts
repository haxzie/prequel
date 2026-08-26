/**
 * The maths behind the pictures of an angle: the pad's plate and the preset
 * thumbnails under it.
 *
 * Apart from the component because this is the half that can be wrong without
 * anything looking broken. A plate leaning the opposite way to the export still
 * renders a perfectly convincing trapezium — it is only wrong against
 * `rotatedQuad`, which is in another file and another process's worth of maths
 * away. Pulled out here, it can be checked against that directly.
 */

/**
 * The CSS transform for a plate at this angle.
 *
 * `rotateY` is written second so it applies *first*, matching the order
 * `rotatedQuad` composes them in — yaw about the vertical axis, then pitch.
 * Swapping them gives a different plate at large angles.
 *
 * The angle is passed through unnegated. CSS points Y down and +Z at the
 * viewer, so a positive `rotateX` sends the top edge away, which is what the
 * renderer does too: `rotatedQuad` divides by `distance - zb`, and the top
 * corner's `zb` is `-halfHeight * sin(pitch)` — negative for a positive pitch,
 * so the top is farther. This negated it once, and drew every pitch the
 * opposite way to the export, so "Lean back" leaned forwards in the control
 * that exists to show you what it does.
 */
export function plateTransform(rotateX: number, rotateY: number): string {
  return `rotateX(${String(rotateX)}deg) rotateY(${String(rotateY)}deg)`;
}

/**
 * Which way "away" points, as a CSS gradient angle.
 *
 * A positive pitch leans the top away and a positive yaw sends the right edge
 * back, so the far direction is `(rotateY, rotateX)` with y measured upwards. CSS gradient
 * angles are clockwise from "to top", which is exactly what `atan2(x, y)`
 * gives — no conversion, and none should be added.
 */
export function shadingAngle(rotateX: number, rotateY: number): number {
  return (Math.atan2(rotateY, rotateX) * 180) / Math.PI;
}

/**
 * How pronounced the shading is, from 0 at flat to 1 at [`SHADED_AT`].
 *
 * Flat has to collapse to zero rather than be special-cased downstream:
 * `atan2(0, 0)` is a legitimate 0, so a level plate would otherwise pick up a
 * gradient pointing confidently upwards.
 */
export function shadingStrength(rotateX: number, rotateY: number): number {
  return Math.min(Math.hypot(rotateX, rotateY) / SHADED_AT, 1);
}

/**
 * The lean, in degrees, at which the shading reaches full strength.
 *
 * Below the editor's own 30° limit on purpose: the angles anyone actually uses
 * live under 15°, and scaling to the limit would leave every real setting
 * shaded so faintly that the cue is not there when it is needed.
 */
export const SHADED_AT = 14;
