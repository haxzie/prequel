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

/**
 * Peaks per second of recording. 50ms resolution.
 *
 * Has to agree with `BUCKETS_PER_SECOND` in `crates/prequel-render/src/peaks.rs`,
 * which is where the peaks are made: an index here is turned back into a time
 * on the session clock, and a different count there draws every clip's sound
 * at the wrong speed.
 */
export const BUCKETS_PER_SECOND = 20;

/** How many buckets a span of media time occupies. */
export function bucketCount(duration: MediaTime): number {
  return Math.max(1, Math.ceil((duration / NS_PER_SECOND) * BUCKETS_PER_SECOND));
}

/**
 * A track's raw peaks, as 0-1 fractions of its loudest, cut or padded to the
 * length the manifest says the track has.
 *
 * Normalised, so a quietly-recorded take still shows a shape rather than a
 * flat line. Silence stays silent: there is nothing to scale it against. Per
 * track rather than after the merge, so a quiet microphone is not flattened
 * by loud system audio beside it.
 *
 * Sized to `buckets` rather than to what came back: AAC pads the end of a
 * file with a frame or so, and the manifest's duration is what every other
 * part of the timeline places this track by.
 */
export function normalised(peaks: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(0, buckets));
  if (out.length === 0 || peaks.length === 0) return out;

  let loudest = 0;
  for (let bucket = 0; bucket < peaks.length; bucket += 1) {
    const value = Math.abs(peaks[bucket]!);
    if (value > loudest) loudest = value;
  }
  if (loudest === 0) return out;

  const run = Math.min(out.length, peaks.length);
  for (let bucket = 0; bucket < run; bucket += 1) {
    out[bucket] = Math.abs(peaks[bucket]!) / loudest;
  }

  return out;
}

/**
 * The same peaks, stretched between what is quiet and what is loud *for this
 * file* rather than against its single loudest moment.
 *
 * For music, which is the one thing on this timeline that has been mastered.
 * A recording of somebody talking spends half its time near silence, so
 * dividing by the loudest sample leaves a shape full of gaps and peaks; a
 * finished track is compressed to sit between about two-thirds and full the
 * whole way through, and the same arithmetic draws it as a flat slab with a
 * ripple on top. The beat is in there — it is simply in the top third of the
 * box, where a 40-pixel bar gives it four pixels to show in.
 *
 * So the floor and the ceiling come from the file's own distribution. Below
 * `QUIET` is drawn as nothing and above `LOUD` as full, and everything between
 * is spread across the whole height. A percentile rather than the minimum and
 * maximum: one silent moment at the top of the song and one clipped drum hit
 * would otherwise set both ends and leave the rest as flat as before.
 *
 * Stable for the whole file, which is what matters once a bed has been cut in
 * two: both halves are drawn against the same pair of numbers, so the same
 * music is the same height on both sides of the join. Scaling to whatever
 * happens to be on screen would make a cut change the shape of the music
 * either side of it.
 */
export function normalisedRange(peaks: Float32Array, buckets: number): Float32Array {
  const out = normalised(peaks, buckets);
  if (out.length === 0) return out;

  const sorted = Float32Array.from(out).sort();
  const lo = sorted[Math.floor((sorted.length - 1) * QUIET)]!;
  const hi = sorted[Math.floor((sorted.length - 1) * LOUD)]!;
  const span = hi - lo;

  // Nothing to stretch: a file that really is flat — a sine, a silence, a
  // tone — is drawn as the flat thing it is rather than as amplified noise.
  if (span < FLAT) return out;

  for (let bucket = 0; bucket < out.length; bucket += 1) {
    const value = out[bucket]!;

    out[bucket] =
      value <= lo
        ? // Under the quiet mark, ramped down to nothing rather than cut off
          // there. Silence has to draw as silence — a bed with a gap in it
          // must show the gap — and a quiet intro has to be *low* rather than
          // absent, which is what a hard floor at `lo` would make of the first
          // ten seconds of most songs.
          (value / Math.max(lo, 1e-6)) * LOWEST
        : LOWEST + (1 - LOWEST) * Math.min(1, (value - lo) / span);
  }

  return out;
}

/** Where the floor and the ceiling are taken from, as fractions of the file. */
const QUIET = 0.05;
const LOUD = 0.98;

/** Below this much difference between the two there is nothing to stretch. */
const FLAT = 0.05;

/**
 * Where the quiet end of a file lands, as a fraction of the box.
 *
 * Not the floor. Stretching the quietest part of a song down to nothing
 * leaves a bar with no wave in it wherever that part is on screen — which for
 * most tracks is the intro, and so is exactly the stretch somebody is looking
 * at when they first lay the bed down.
 *
 * Close to half, which is higher than it looks: the wave is drawn into the
 * room under the level line, so at an ordinary volume this is 45% of half the
 * bar — nine pixels of forty. A quarter was tried and a quiet intro came out
 * as a five-pixel sliver that read as a bar with nothing in it.
 */
const LOWEST = 0.45;

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
 * One file's peaks, tiled to fill `buckets`.
 *
 * For a music bed that repeats. The wrap is deliberately the same one
 * `musicFileTime` makes — past the end, the file starts again from its own
 * beginning rather than from wherever the bed was trimmed to — so the wave
 * drawn on the bar is the sound that will come out of it. A second rule here
 * would be a bar whose shape does not match what it plays, which is worse
 * than no wave at all.
 *
 * Returns the peaks unchanged when there is nothing to fill.
 */
export function repeated(peaks: Float32Array, buckets: number): Float32Array {
  if (peaks.length === 0 || buckets <= peaks.length) return peaks;

  const out = new Float32Array(buckets);
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    out[bucket] = peaks[bucket % peaks.length]!;
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
  /**
   * How several buckets become one drawn point.
   *
   * `"peak"` for a recording: a word is a transient, and the loudest bucket in
   * a step is the thing that has to survive being drawn at a lower resolution
   * than it was measured at.
   *
   * `"mean"` for music, where that rule inverts. A track has a beat in it
   * every half second, so at any zoom where a step covers more than one beat
   * *every* step contains one — the maximum is the same number the whole way
   * along, and a four-minute song draws as a flat slab however it is
   * normalised. The average keeps what actually varies over a bed's length:
   * the quiet intro, the chorus, the breakdown.
   */
  reduce: "peak" | "mean" = "peak",
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
    let total = 0;
    let counted = 0;
    for (let bucket = start; bucket < end && bucket < peaks.length; bucket += 1) {
      if (bucket < 0) continue;
      if (peaks[bucket]! > peak) peak = peaks[bucket]!;
      total += peaks[bucket]!;
      counted += 1;
    }

    heights[step] = reduce === "mean" && counted > 0 ? total / counted : peak;
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
