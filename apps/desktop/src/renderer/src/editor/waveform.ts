/**
 * Turning audio into something a clip can draw.
 *
 * Peaks rather than samples: a ten-minute take is tens of millions of samples
 * and a clip is a few hundred pixels wide, so the only useful representation is
 * one amplitude per small slice of time. Twenty a second is fine enough to see
 * a word land and coarse enough to hold the whole recording in a few tens of
 * kilobytes.
 *
 * Pure, so the arithmetic is testable without decoding anything.
 */
import type { MediaTime } from "../../../shared/manifest";

const NS_PER_SECOND = 1_000_000_000;

/** Peaks per second of recording. 50ms resolution. */
export const BUCKETS_PER_SECOND = 20;

/** How many buckets a span of media time occupies. */
export function bucketCount(duration: MediaTime): number {
  return Math.max(1, Math.ceil((duration / NS_PER_SECOND) * BUCKETS_PER_SECOND));
}

/**
 * The loudest sample in each bucket, as a 0-1 fraction of the loudest overall.
 *
 * Peak rather than RMS: a filled waveform is read for where the sound *is*, and
 * RMS flattens exactly the transients — a consonant, a click — that make speech
 * legible at a glance.
 *
 * Normalised, so a quietly-recorded take still shows a shape rather than a flat
 * line. Silence stays silent: there is nothing to scale it against.
 */
export function peaksFrom(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(0, buckets));
  if (out.length === 0 || samples.length === 0) return out;

  const per = samples.length / out.length;
  let loudest = 0;

  for (let bucket = 0; bucket < out.length; bucket += 1) {
    const start = Math.floor(bucket * per);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((bucket + 1) * per)));

    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(samples[index]!);
      if (value > peak) peak = value;
    }

    out[bucket] = peak;
    if (peak > loudest) loudest = peak;
  }

  if (loudest > 0) {
    for (let bucket = 0; bucket < out.length; bucket += 1) out[bucket]! /= loudest;
  }

  return out;
}

/**
 * Lays a track's peaks onto the session timeline.
 *
 * A track that opened late starts partway along — the same offset the manifest
 * records and everything else honours. Drawing every track from zero would put
 * the camera's audio ahead of the picture it belongs to.
 */
export function placeOnSession(
  peaks: Float32Array,
  offset: MediaTime,
  total: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, total));
  const start = Math.floor((offset / NS_PER_SECOND) * BUCKETS_PER_SECOND);

  for (let bucket = 0; bucket < peaks.length; bucket += 1) {
    const at = start + bucket;
    if (at >= 0 && at < out.length) out[at] = peaks[bucket]!;
  }

  return out;
}

/**
 * Merges several tracks into the one shape a clip draws.
 *
 * The loudest of them at each moment, not the sum: two tracks at half volume
 * are not one at full, and a summed wave clips into a solid block the moment
 * anything overlaps — which for a screen recording with commentary is most of
 * it.
 */
export function mergePeaks(tracks: Float32Array[]): Float32Array {
  const total = tracks.reduce((longest, track) => Math.max(longest, track.length), 0);
  const out = new Float32Array(total);

  for (const track of tracks) {
    for (let bucket = 0; bucket < track.length; bucket += 1) {
      if (track[bucket]! > out[bucket]!) out[bucket] = track[bucket]!;
    }
  }

  return out;
}

/**
 * How many points a path is drawn with, however wide the clip.
 *
 * Deliberately coarse. At one point per 50ms bucket a half-minute clip is 600
 * points across a few hundred pixels, which reads as hair rather than as a
 * wave — no amount of curve smoothing rescues detail finer than the pixels
 * drawing it. Fewer, wider points is what makes the curve visible as a curve.
 */
const RESOLUTION = 160;

/** A quiet passage still reads as a track rather than as a gap. */
const FLOOR = 0.04;

/**
 * An SVG path for the peaks between two source times, standing on the bottom
 * edge.
 *
 * Drawn in a 0-1 by 0-1 box and stretched by the SVG's own
 * `preserveAspectRatio="none"`, so a clip that resizes or zooms does not need
 * the path rebuilt — which is what keeps this off the hot path entirely.
 *
 * One-sided: the two halves of a mirrored wave carry the same number twice, and
 * a single wave standing on the clip's floor leaves the rest of the clip for
 * things that are not the audio.
 *
 * Returns an empty string when there is nothing to draw, so the caller can skip
 * rendering rather than emit a degenerate path.
 */
export function wavePath(
  peaks: Float32Array,
  from: MediaTime,
  to: MediaTime,
  resolution = RESOLUTION,
): string {
  if (peaks.length === 0 || to <= from) return "";

  const first = Math.floor((from / NS_PER_SECOND) * BUCKETS_PER_SECOND);
  const last = Math.ceil((to / NS_PER_SECOND) * BUCKETS_PER_SECOND);
  const span = last - first;
  if (span <= 0) return "";

  // Never more points than the span has, and never so many that a long clip
  // builds a path with thousands of segments nobody can see.
  const steps = Math.max(2, Math.min(resolution, span));
  const heights = new Float32Array(steps);

  for (let step = 0; step < steps; step += 1) {
    // The loudest bucket in this step's share, so a peak survives being drawn
    // at lower resolution rather than being missed between two samples.
    const start = first + Math.floor((step * span) / steps);
    const end = Math.max(start + 1, first + Math.floor(((step + 1) * span) / steps));

    let peak = 0;
    for (let bucket = start; bucket < end && bucket < peaks.length; bucket += 1) {
      if (bucket >= 0 && peaks[bucket]! > peak) peak = peaks[bucket]!;
    }

    heights[step] = peak;
  }

  const eased = smooth(heights);
  const points: [number, number][] = [];

  for (let step = 0; step < steps; step += 1) {
    points.push([step / (steps - 1), 1 - Math.max(eased[step]!, FLOOR)]);
  }

  return fill(points);
}

/**
 * Softens a single loud bucket into its neighbours.
 *
 * A three-tap pass, weighted towards the sample itself so a transient still
 * lifts the wave rather than being averaged away — the point is to round the
 * spike, not to lose it. Curve fitting alone cannot do this: a quadratic
 * through a lone spike is still a spike, only a rounder one.
 */
function smooth(heights: Float32Array): Float32Array {
  const out = new Float32Array(heights.length);

  for (let index = 0; index < heights.length; index += 1) {
    // Clamped at the ends rather than wrapped, so the first and last points do
    // not borrow from the other end of the clip.
    const before = heights[Math.max(0, index - 1)]!;
    const after = heights[Math.min(heights.length - 1, index + 1)]!;

    out[index] = before * 0.25 + heights[index]! * 0.5 + after * 0.25;
  }

  return out;
}

/**
 * Closes a run of points into a filled shape standing on `y = 1`.
 *
 * Curved through the midpoints between successive points, each point serving as
 * the control for the segment it sits on. The alternative — a cubic through
 * every point — overshoots on a sharp rise, and an overshoot here means the
 * wave leaves the top of the box on a loud transient.
 */
function fill(points: [number, number][]): string {
  const at = ([x, y]: [number, number]) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];

  let path = `M${(0).toFixed(4)},${(1).toFixed(4)}L${at(points[0]!)}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    path += `Q${at(points[index]!)} ${at(mid(points[index]!, points[index + 1]!))}`;
  }

  path += `L${at(points[points.length - 1]!)}L${(1).toFixed(4)},${(1).toFixed(4)}Z`;
  return path;
}
