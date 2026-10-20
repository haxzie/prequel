/**
 * Turning a zoom into the shape drawn inside its bar.
 *
 * The level itself comes from `zoomEnvelope` in `shared/layout.ts`, and the
 * zoom's reach from `zoomSpans` beside it — both read the stages the picture is
 * actually placed on, so nothing here decides how far in a zoom goes, when it
 * leaves rest, or how it eases. What is left is the two mappings a drawing
 * needs: a moment onto the bar's width, and a level onto a height.
 *
 * **The bar holds the whole move, not only the hold.** A zoom's travel happens
 * outside its span — the span is where the picture has already arrived — so the
 * shape is drawn over the zoom's *reach*, the move in and the move out
 * included, squeezed into the bar. The bar's width is still the hold and still
 * honest; what is inside it is the zoom's shape rather than a strip of the
 * timeline. Drawn to scale instead, the shoulders stood outside the bar and
 * read as something passing behind the row, and clipped to the span they were
 * lost entirely and every zoom was a flat line.
 *
 * The proportions still say something: a slow zoom spends more of itself
 * travelling, so its shoulders are wider than a snappy one's.
 *
 * Pure, so both mappings are testable without a canvas or a row.
 */
import type { MediaTime } from "../../../shared/manifest";

/**
 * The lowest the top of the scale may be, as a zoom level.
 *
 * Twice the stock zoom, so the ordinary one has somewhere left to go. Neither
 * extreme works on its own: against the 8x a zoom may reach, every ordinary
 * shot is a sliver and the whole row reads as flat — and against the row's
 * deepest alone, a recording with one zoom in it always draws that zoom full
 * height, which is a bar saying nothing at all.
 *
 * So the scale is this or the row's deepest, whichever is more. A row of 2x and
 * 3x shots is read against 4, and pushing one to 6x rescales all of them.
 */
const MIN_TOP = 4;

/**
 * Where the un-zoomed picture and the deepest zoom sit in a bar, as fractions
 * of its height measured from the top.
 *
 * Inset at both ends rather than using the whole box. A line drawn at exactly 0
 * has half its width outside the box and is clipped to a hairline along the top
 * edge, where it reads as part of the bar's own border rather than as the top
 * of a shape — and the same at the bottom.
 */
export const BAND = { rest: 0.94, deepest: 0.12 };

/**
 * How many points a bar's shape is drawn from.
 *
 * The shoulders are eased curves, so this is drawing a curve rather than three
 * straight runs: too few and the move in arrives as a ramp with a corner on it.
 * Forty across a bar a few hundred pixels wide is a point every several pixels,
 * which is finer than the rounded join between them can show.
 */
const STEPS = 40;

/**
 * The top of the scale every bar in a row is measured against.
 *
 * Worked out once for the row and handed to each bar, so two bars on the same
 * row are comparable. Asked of the envelope rather than of the zoom list
 * because that is what the heights are read from.
 */
export function zoomCeiling(envelope: readonly { at: MediaTime; level: number }[]): number {
  return Math.max(MIN_TOP, ...envelope.map((sample) => sample.level));
}

/**
 * How much of its height a level is drawn at, 0 at rest and 1 at the ceiling.
 *
 * The square root of the share, not the share itself. Zoom is a ratio, and the
 * difference between 1x and 1.5x is a far bigger change on screen than the one
 * between 3x and 3.5x — read straight, a 1.5x came out a sixth of its bar and
 * looked like nothing at all, which is what a flat bar was. The root spends
 * more of the height where the levels people actually use are, and still orders
 * them: deeper is always taller.
 */
function heightOf(level: number, ceiling: number): number {
  const share = Math.min(1, Math.max(0, (level - 1) / (ceiling - 1)));
  return Math.sqrt(share);
}

/**
 * One bar's shape, as a line and as the area under it.
 *
 * Both from one walk, because they are one shape: the area is the line with its
 * ends dropped to where the un-zoomed picture sits, and building them apart is
 * two chances to disagree about where that is.
 *
 * Drawn in a 0-1 by 0-1 box and stretched by the SVG's own
 * `preserveAspectRatio="none"`, exactly as `wavePath` is, so zooming the strip
 * or resizing the window does not rebuild it.
 *
 * `reach` is the zoom's whole life from `zoomSpans` — the move in, the hold and
 * the move out — and it is that, rather than the slice, which is laid across
 * the bar. See the note at the top of this file.
 *
 * Empty strings when there is nothing to draw, so the caller can skip rendering
 * rather than emit a degenerate path.
 */
export function barCurve(
  envelope: readonly { at: MediaTime; level: number }[],
  reach: { from: MediaTime; to: MediaTime },
  ceiling: number,
  steps = STEPS,
): { line: string; area: string } {
  const nothing = { line: "", area: "" };
  const span = reach.to - reach.from;
  if (envelope.length === 0 || span <= 0 || ceiling <= 1) return nothing;

  const points: { x: number; y: number }[] = [];

  for (let step = 0; step <= steps; step += 1) {
    const x = step / steps;
    const level = levelAt(envelope, reach.from + span * x);
    // Measured down from the top, because SVG's y grows that way.
    const y = BAND.rest - (BAND.rest - BAND.deepest) * heightOf(level, ceiling);
    points.push({ x: round(x), y: round(y) });
  }

  const along = points.map((point) => `L${point.x} ${point.y}`).join(" ");

  return {
    line: `M${points[0]!.x} ${points[0]!.y} ${points
      .slice(1)
      .map((point) => `L${point.x} ${point.y}`)
      .join(" ")}`,
    // Closed on the resting line rather than the floor of the bar: 1x is no
    // zoom at all, and a fill reaching the bottom would give it a band saying
    // otherwise.
    area: `M0 ${BAND.rest} ${along} L1 ${BAND.rest} Z`,
  };
}

/**
 * The level at one moment, interpolated between samples.
 *
 * Outside the track it is whichever end is nearest, which is the un-zoomed
 * picture: the envelope opens and closes at rest, so a moment before the first
 * zoom or after the last is one where nothing is happening.
 */
function levelAt(track: readonly { at: MediaTime; level: number }[], at: MediaTime): number {
  if (track.length === 0) return 1;
  if (at <= track[0]!.at) return track[0]!.level;
  if (at >= track[track.length - 1]!.at) return track[track.length - 1]!.level;

  let low = 0;
  let high = track.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (track[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const before = track[low]!;
  const after = track[high]!;
  const span = after.at - before.at;
  return span > 0
    ? before.level + ((after.level - before.level) * (at - before.at)) / span
    : before.level;
}

/**
 * Four decimals, which is a tenth of a pixel on a four-thousand-pixel strip.
 *
 * The path is written in fractions of the box, so the numbers are all 0 to 1
 * and full precision would be a kilobyte of string rewritten on every edit for
 * detail no display can show.
 */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
