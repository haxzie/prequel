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

/** A contiguous span of the source recording, kept in the edit. */
export interface Slice {
  id: string;
  /** Half-open range of source time: `start` is included, `end` is not. */
  source: { start: MediaTime; end: MediaTime };
}

/** A slice with its position in the edit worked out. */
export interface PlacedSlice extends Slice {
  /** Project time at which this slice begins. */
  timelineStart: MediaTime;
  duration: MediaTime;
}

/**
 * Lays slices end to end.
 *
 * Position is derived rather than stored: a slice that carried both its source
 * range and its project position could disagree with itself, and the
 * disagreement would be invisible in the saved file.
 */
export function place(slices: readonly Slice[]): PlacedSlice[] {
  let at = 0;
  return slices.map((slice) => {
    const duration = Math.max(0, slice.source.end - slice.source.start);
    const placed = { ...slice, timelineStart: at, duration };
    at += duration;
    return placed;
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

/** Project time → source time. Null when the edit is empty. */
export function toSourceTime(placed: readonly PlacedSlice[], time: MediaTime): MediaTime | null {
  const slice = sliceAt(placed, time);
  if (!slice) return null;

  const into = Math.min(Math.max(0, time - slice.timelineStart), slice.duration);
  return slice.source.start + into;
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
    const from = Math.max(source.start, slice.source.start);
    const to = Math.min(source.end, slice.source.end);
    // This clip keeps none of the span. An empty overlap is not a zero-length
    // one: `to === from` is a clip that merely touches the span at a boundary.
    if (to <= from) continue;

    start ??= slice.timelineStart + (from - slice.source.start);
    end = slice.timelineStart + (to - slice.source.start);
  }

  return start === null || end === null ? null : { start, end };
}

/** Source time → project time, or null when that moment was cut out. */
export function toProjectTime(placed: readonly PlacedSlice[], source: MediaTime): MediaTime | null {
  for (const slice of placed) {
    if (source >= slice.source.start && source < slice.source.end) {
      return slice.timelineStart + (source - slice.source.start);
    }
  }
  return null;
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
 * How much of a gap at a track's edges is closed by holding its nearest frame.
 *
 * Mirrored by `EDGE_TOLERANCE` in `crates/prequel-render/src/export.rs`, so the
 * export shows the camera over exactly the span the preview does. Sized to
 * cover a device opening late — a few hundred milliseconds — and nothing like
 * long enough to paper over a track that failed.
 */
const EDGE_TOLERANCE: MediaTime = 500_000_000;

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

/** Seconds, which is the unit `HTMLMediaElement.currentTime` speaks. */
export function toSeconds(ns: MediaTime): number {
  return ns / 1_000_000_000;
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

  const source = slice.source.start + (time - slice.timelineStart);

  return placed.flatMap((candidate): Slice[] =>
    candidate.id === slice.id
      ? [
          { id: candidate.id, source: { start: candidate.source.start, end: source } },
          { id: id(), source: { start: source, end: candidate.source.end } },
        ]
      : [{ id: candidate.id, source: { ...candidate.source } }],
  );
}
