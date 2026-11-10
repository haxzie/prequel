/**
 * Mapping between the three timelines an edit involves.
 *
 * There are three, and confusing any two of them is the classic way to build an
 * editor that is subtly out of sync:
 *
 * - **Project time** — where the playhead is in the edit, after cuts.
 * - **Source time** — where that lands in the original recording, on the
 *   session clock the manifest uses.
 * - **File time** — where that lands inside one track's own file.
 *
 * Every function here is pure, so the arithmetic can be tested without a
 * window, a video element or a recording.
 */
import type { TrackMedia } from "../../../shared/contract";
import type { MediaTime } from "../../../shared/manifest";
import { MAX_SPEED, MIN_SPEED, runsOf, type Skip } from "../../../shared/project";

/** A span of the source recording kept in the edit, less the holes inside it. */
export interface Slice {
  id: string;
  /** Half-open range of source time: `start` is included, `end` is not. */
  source: { start: MediaTime; end: MediaTime };
  /** The stretches of that range this slice steps over — see `Skip` in `project.ts`. */
  skips?: readonly Skip[];
  /** Playback rate. 1 is unchanged; project time covers `1 / speed` as much source. */
  speed: number;
}

/**
 * One contiguous stretch a slice actually plays.
 *
 * A slice with no holes is one run. Everything that maps between project time
 * and source time walks runs rather than slices, because a hole inside a clip
 * moves project time on exactly the way a cut between two clips does — the
 * difference is only what is on the strip.
 */
export interface SliceRun {
  /** Half-open range of source time. */
  source: { start: MediaTime; end: MediaTime };
  /** Project time at which this run begins. */
  timelineStart: MediaTime;
  duration: MediaTime;
}

/** Where a slice sits in the edit, and what it plays there. */
export interface Placement {
  /** Project time at which this slice begins. */
  timelineStart: MediaTime;
  /** How long it runs for, which is its played time and not its whole span. */
  duration: MediaTime;
  /** What it plays, in order, with each piece's place in the edit. */
  runs: SliceRun[];
}

/**
 * A slice with its position in the edit worked out.
 *
 * Generic over what was passed in, so a caller that laid out *project* slices
 * gets its overrides back on the other side rather than having to index the
 * two lists in step — which is a pairing nothing checks and a reorder breaks.
 */
export type PlacedSlice<T extends Slice = Slice> = T & Placement;

/** A slice's speed, held inside the bounds the rest of the app assumes. */
function rateOf(slice: Slice): number {
  return Math.min(Math.max(slice.speed, MIN_SPEED), MAX_SPEED);
}

/**
 * Lays slices end to end.
 *
 * Position is derived rather than stored: a slice that carried both its source
 * range and its project position could disagree with itself, and the
 * disagreement would be invisible in the saved file.
 */
export function place<T extends Slice>(slices: readonly T[]): PlacedSlice<T>[] {
  let at = 0;
  return slices.map((slice) => {
    const rate = rateOf(slice);
    const timelineStart = at;

    // Output duration shrinks as speed rises: twice the rate covers the same
    // source span in half the project time.
    const runs = runsOf(slice).map((source) => {
      const run = {
        source,
        timelineStart: at,
        duration: Math.max(0, source.end - source.start) / rate,
      };
      at += run.duration;
      return run;
    });

    return { ...slice, timelineStart, duration: at - timelineStart, runs };
  });
}

/** Total length of the edit. */
export function totalDuration(placed: readonly PlacedSlice[]): MediaTime {
  const last = placed.at(-1);
  return last ? last.timelineStart + last.duration : 0;
}

/**
 * The slice playing at a project time.
 *
 * Slices are half-open, so the boundary between two of them belongs to the
 * later one — which is what makes a cut land on a frame rather than between
 * two. The very end of the edit has no slice after it, so it resolves to the
 * last one instead of to nothing.
 */
export function sliceAt(placed: readonly PlacedSlice[], time: MediaTime): PlacedSlice | undefined {
  if (placed.length === 0) return undefined;

  const found = placed.find(
    (slice) => time >= slice.timelineStart && time < slice.timelineStart + slice.duration,
  );
  if (found) return found;

  const last = placed.at(-1)!;
  return time >= last.timelineStart + last.duration ? last : placed[0];
}

/**
 * Project time → source time. Null when the edit is empty.
 *
 * Resolved against the run the moment falls in, not the slice: a clip with a
 * hole in it plays two stretches of footage that are seconds apart, and
 * measuring from the clip's own start would put everything after the hole as
 * far out as the hole is long.
 */
export function toSourceTime(placed: readonly PlacedSlice[], time: MediaTime): MediaTime | null {
  const slice = sliceAt(placed, time);
  if (!slice) return null;

  const run = runAt(slice, time);
  if (!run) return slice.source.start;

  const into = Math.min(Math.max(0, time - run.timelineStart), run.duration);
  // Project time advances at `speed`x the rate source time does, so the offset
  // into the run covers that much more source ground than it looks like.
  return run.source.start + into * slice.speed;
}

/**
 * The run of a slice a project time falls in.
 *
 * Half-open like everything else, and clamped to the ends: a moment at the
 * very end of the last run belongs to it rather than to nothing, which is what
 * lets the edit stop on its final frame.
 */
function runAt(slice: Placement, time: MediaTime): SliceRun | undefined {
  const found = slice.runs.find(
    (run) => time >= run.timelineStart && time < run.timelineStart + run.duration,
  );
  if (found) return found;

  const last = slice.runs.at(-1);
  if (!last) return undefined;
  return time >= last.timelineStart + last.duration ? last : slice.runs[0];
}

/**
 * The part of the edit a source span still covers.
 *
 * `toProjectTime` answers for a single moment and says "nowhere" when that
 * moment was cut out. A zoom is a *range*, and a range whose start was cut away
 * usually still covers plenty of surviving footage — so asking about its edges
 * one at a time throws away the whole span the moment either edge lands in a
 * gap. That is how a zoom comes to be invisible on the timeline while still
 * occupying the source range it was given, which reads as clicks that silently
 * do nothing.
 *
 * Drawn as one bar across a cut rather than as a piece per clip: the zoom does
 * apply either side of the join, and splitting it would suggest two zooms.
 *
 * Null only when the span survived nowhere at all.
 */
export function spanInProject(
  placed: readonly PlacedSlice[],
  source: { start: MediaTime; end: MediaTime },
): { start: MediaTime; end: MediaTime } | null {
  let start: MediaTime | null = null;
  let end: MediaTime | null = null;

  for (const slice of placed) {
    for (const run of slice.runs) {
      const from = Math.max(source.start, run.source.start);
      const to = Math.min(source.end, run.source.end);
      // This run keeps none of the span. An empty overlap is not a zero-length
      // one: `to === from` is a run that merely touches the span at a boundary.
      if (to <= from) continue;

      // Inverse of `toSourceTime`'s scaling: a source-time span covers
      // `1 / speed` as much project time.
      start ??= run.timelineStart + (from - run.source.start) / slice.speed;
      end = run.timelineStart + (to - run.source.start) / slice.speed;
    }
  }

  return start === null || end === null ? null : { start, end };
}

/**
 * Source time → project time, or null when that moment was cut out.
 *
 * Cut out covers both ways footage leaves an edit: a stretch no clip holds,
 * and a hole inside one.
 */
export function toProjectTime(placed: readonly PlacedSlice[], source: MediaTime): MediaTime | null {
  for (const slice of placed) {
    for (const run of slice.runs) {
      if (source >= run.source.start && source < run.source.end) {
        return run.timelineStart + (source - run.source.start) / slice.speed;
      }
    }
  }
  return null;
}

/**
 * `toProjectTime` with the clip's end matched too, for the edge of a span.
 *
 * Slices are half-open, so a zoom or a text that runs exactly to the end of
 * its clip would otherwise map to nothing — and ending on a cut is the normal
 * way to zoom out into one. The first clip that holds the moment wins, so a
 * source time on a join between two adjacent clips lands on the earlier one.
 */
export function toProjectTimeThrough(
  placed: readonly PlacedSlice[],
  source: MediaTime,
): MediaTime | null {
  for (const slice of placed) {
    for (const run of slice.runs) {
      if (source >= run.source.start && source <= run.source.end) {
        return run.timelineStart + (source - run.source.start) / slice.speed;
      }
    }
  }
  return null;
}

/**
 * Project time → source time, with a moment on a join landing on the clip that
 * *ends* there.
 *
 * `toSourceTime`'s mirror of `toProjectTimeThrough`, and wanted for the same
 * reason read the other way: the end of a span that runs exactly to a cut
 * belongs to the clip it was over, not to the one starting there. Used when a
 * dragged span's far edge is mapped back onto the recording — taken through
 * `toSourceTime` instead, a zoom dropped flush against a cut would come back a
 * clip later and several seconds long.
 *
 * Null past the end of the edit, which has no clip to belong to.
 */
export function toSourceTimeThrough(
  placed: readonly PlacedSlice[],
  time: MediaTime,
): MediaTime | null {
  for (const slice of placed) {
    for (const run of slice.runs) {
      const end = run.timelineStart + run.duration;
      if (time > run.timelineStart && time <= end) {
        return run.source.start + (time - run.timelineStart) * slice.speed;
      }
    }
  }

  // Only the very start of the edit is not inside any clip read this way.
  return placed[0] && time <= placed[0].timelineStart ? placed[0].source.start : null;
}

/**
 * Where a track should be seeked to, for a moment in source time.
 *
 * Null when the track was not yet recording — the camera opens a few hundred
 * milliseconds after the screen, and there is no frame to show for that gap.
 * Holding its first frame instead would misrepresent the take, so the caller
 * draws nothing and the exporter does the same.
 *
 * The offset comes from the manifest because that is the only place it is
 * recorded: every session file is written zero-based, so the media itself
 * cannot say when its track began. Subtracting a probed file start as well
 * would double-count the correction.
 */
export function toFileTime(track: TrackMedia, source: MediaTime): MediaTime | null {
  const into = source - track.offset;

  // Held at the nearest frame across a short gap at either end. Devices open a
  // few hundred milliseconds apart and stop a few tens apart — the camera
  // routinely last — so *every* recording has one, and blanking it reads as the
  // camera arriving late and vanishing before the end rather than as the
  // honest "there was no frame here".
  if (into < 0) return into >= -EDGE_TOLERANCE ? 0 : null;

  if (track.duration > 0 && into >= track.duration) {
    // Beyond the tolerance the track really did stop — a camera unplugged
    // mid-take — and freezing its last frame over the rest of the recording
    // would misrepresent it far more than a gap does.
    if (into - track.duration > EDGE_TOLERANCE) return null;
    return Math.max(0, track.duration - 1);
  }

  return into;
}

/**
 * How much of a gap at a segment's edges is closed by holding its nearest frame.
 *
 * Mirrored by `EDGE_TOLERANCE` in `crates/prequel-render/src/export.rs`, so the
 * export shows the camera over exactly the span the preview does. Sized to
 * cover a device opening late — a few hundred milliseconds — and nothing like
 * long enough to paper over a track that failed.
 *
 * Exported for `segments.ts`, which decides *which* file a moment falls in and
 * has to close a gap over the same span this does inside one.
 */
export const EDGE_TOLERANCE: MediaTime = 500_000_000;

/**
 * Source-time step that counts as landing somewhere else rather than playing on.
 *
 * Comfortably more than a frame — including the several a busy frame can drop at
 * once — and far less than any cut that actually moves the playhead.
 */
const CONTINUITY: MediaTime = 100_000_000;

/**
 * Whether the playhead moved somewhere else between two ticks.
 *
 * The question a media element needs answered, because the answer decides
 * between a seek and a rate nudge, and a seek flushes the decoder: `readyState`
 * drops for the two or three frames it takes to produce the new picture.
 *
 * Asked of source time rather than of which slice is under the playhead. An
 * ordinary cut is `splitAt` leaving its two halves *contiguous* in the source, so
 * crossing one lands the decoder exactly where it already is — and flushing it
 * there costs those frames for no change in what is shown.
 *
 * The first tick of a session has no previous time and is not a jump: nothing has
 * moved yet, and the drift correction seeks to the start on its own.
 */
export function hasJumped(previous: MediaTime | null, source: MediaTime | null): boolean {
  if (previous === null || source === null) return false;
  return Math.abs(source - previous) > CONTINUITY;
}

/**
 * Splits a slice at a project time.
 *
 * Returns the list unchanged when the cut lands on a boundary or outside the
 * edit: a zero-length slice is not something the timeline can draw or the
 * exporter can render, and silently creating one would be worse than declining.
 */
export function splitAt(slices: readonly Slice[], time: MediaTime, id: () => string): Slice[] {
  const placed = place(slices);
  const slice = placed.find(
    (candidate) =>
      time > candidate.timelineStart && time < candidate.timelineStart + candidate.duration,
  );
  if (!slice) return [...slices];

  // The run the blade landed in, and the same scaling `toSourceTime` uses: the
  // cut lands `time - timelineStart` into that run's *project* time, which
  // covers that much times `speed` of source. A cut on a hole's edge lands at
  // the edge of the run beside it, which is where the picture changes anyway.
  const run =
    slice.runs.find((candidate) => time < candidate.timelineStart + candidate.duration) ??
    slice.runs.at(-1);
  if (!run) return [...slices];
  const source = run.source.start + (time - run.timelineStart) * slice.speed;

  // Each half keeps the holes that fall in it. `skipsWithin` clamps them, so a
  // hole the blade passes through is simply shorter on each side.
  return placed.flatMap((candidate): Slice[] =>
    candidate.id === slice.id
      ? [
          cut(candidate, candidate.id, candidate.source.start, source),
          cut(candidate, id(), source, candidate.source.end),
        ]
      : [cut(candidate, candidate.id, candidate.source.start, candidate.source.end)],
  );
}

/** One slice's range narrowed to `start`–`end`, carrying the holes inside it. */
function cut(slice: Slice, id: string, start: MediaTime, end: MediaTime): Slice {
  const skips = skipsWithin(slice, start, end);
  return { id, source: { start, end }, speed: slice.speed, ...(skips.length > 0 ? { skips } : {}) };
}

/** A slice's holes, clipped to a narrower range and dropped where they fall outside it. */
export function skipsWithin(slice: Slice, start: MediaTime, end: MediaTime): Skip[] {
  return (slice.skips ?? [])
    .map((skip) => ({ start: Math.max(skip.start, start), end: Math.min(skip.end, end) }))
    .filter((skip) => skip.end > skip.start);
}

/**
 * Where a trim drag picked an edge up.
 *
 * `perPixel` is the source time one pixel of the strip was worth at that
 * moment, kept because the strip's scale does not hold still through a drag —
 * see `trimmedTo`.
 */
export interface TrimGrab {
  /** The edge's source time when it was grabbed. */
  source: MediaTime;
  /** Where the pointer was when it was grabbed. */
  clientX: number;
  perPixel: number;
}

/**
 * Where a trim drag has moved an edge to, in source time.
 *
 * Measured from where the drag started rather than from where the clip is now,
 * and that is the whole point: both halves of "how far has this moved" shift
 * *while the drag runs*. Slices are laid end to end, so trimming a head slides
 * every frame after it left; and at the fit zoom the strip is always exactly as
 * wide as the edit, so shortening the edit stretches what is left back out to
 * fill the same room.
 *
 * A delta taken against the live clip therefore feeds its own result back in.
 * The distance the pointer had already travelled was added again on every
 * `pointermove`, so the same gesture landed somewhere different depending on how
 * many events it took to get there — a slow drag of a few pixels ran the edge
 * off the end of the take, a flicked one barely moved it.
 *
 * Says where the pointer is pointing, not what is legal: `trimSlice` clamps.
 */
export function trimmedTo(grab: TrimGrab, clientX: number): MediaTime {
  return grab.source + (clientX - grab.clientX) * grab.perPixel;
}

/**
 * Where a clip marks the presses inside it, as fractions of its own width.
 *
 * Fractions rather than pixels because the clip's width is a percentage of the
 * row, and a mark placed in pixels drifts off its press by whatever rounding
 * the percentage picked up. Speed does not enter into it: a clip covers its
 * whole source span however fast it plays it.
 *
 * Thinned to `gap` pixels apart rather than drawn one per press. A demo that is
 * one continuous stream of clicking is several hundred presses inside a few
 * pixels at the fit zoom: that is a solid bar saying nothing, and a node per
 * press on every clip in the row. The first of a cluster keeps its mark, so a
 * dot always sits on a real press rather than on the average of several.
 *
 * Half-open on the source range, like every other reader of a slice: a press
 * exactly on a cut belongs to the clip that starts there, so splitting a clip
 * under one does not give that click two dots.
 *
 * `clicks` is the manifest's own order, which is ascending — the thinning is
 * one pass and relies on it.
 */
export function clickMarks(
  clicks: readonly MediaTime[],
  slice: PlacedSlice,
  width: number,
  gap: number,
): number[] {
  if (width <= 0 || slice.duration <= 0) return [];

  const marks: number[] = [];
  let last = -Infinity;

  for (const at of clicks) {
    if (at < slice.source.start || at >= slice.source.end) continue;

    // Along the clip as drawn, which is what it plays: a press inside a hole
    // is not on screen at all, and one after a hole sits where the footage
    // after the hole sits rather than where the recording would put it.
    const fraction = fractionOf(slice, at);
    if (fraction === null) continue;

    const x = fraction * width;
    if (x - last < gap) continue;

    last = x;
    marks.push(fraction);
  }

  return marks;
}

/**
 * How far along a clip's drawn width a source moment sits, 0 to 1.
 *
 * Null for a moment the clip does not play. The one place the strip turns
 * source time into a position inside a clip — thumbnails, click dots and the
 * waveform all go through it, so a clip with a hole cannot draw one of them
 * against a different ruler than the other two.
 */
export function fractionOf(slice: PlacedSlice, source: MediaTime): number | null {
  if (slice.duration <= 0) return null;

  for (const run of slice.runs) {
    if (source < run.source.start || source >= run.source.end) continue;
    const into =
      run.timelineStart - slice.timelineStart + (source - run.source.start) / slice.speed;
    return into / slice.duration;
  }
  return null;
}

/** The source moment a fraction of a clip's drawn width lands on. */
export function sourceAtFraction(slice: PlacedSlice, fraction: number): MediaTime | null {
  if (slice.duration <= 0) return null;

  const into = Math.min(Math.max(fraction, 0), 1) * slice.duration;
  for (const run of slice.runs) {
    const from = run.timelineStart - slice.timelineStart;
    if (into < from || into > from + run.duration) continue;
    return run.source.start + (into - from) * slice.speed;
  }
  return slice.runs.at(-1)?.source.end ?? null;
}
