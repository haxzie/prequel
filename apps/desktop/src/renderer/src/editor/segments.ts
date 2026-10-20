/**
 * Which file a moment of the recording is in.
 *
 * A recording can be extended with another take, so a track is a list of
 * segments laid end to end on one session clock rather than a single file — and
 * "seek the camera to this moment" first has to answer "which camera file".
 *
 * This is the only implementation of that lookup. The export resolves a slice's
 * segment here and sends the file name to Rust with it, so there is no second
 * one to disagree with: the same rule `shared/layout.ts` follows for geometry
 * and `prequel-keysound` for sound.
 *
 * Pure, so the arithmetic tests without a window or a media element.
 */
import type { TrackMedia } from "../../../shared/contract";
import type { MediaTime, TrackKind } from "../../../shared/manifest";
import { EDGE_TOLERANCE } from "./timeline";

/**
 * How one media element is addressed.
 *
 * A `TrackKind` alone stopped identifying a file the moment a recording could
 * hold a second take, and the camera's matte is a fifth key rather than a kind
 * of its own — see `CAMERA_MATTE_FILE` in the manifest crate.
 */
export type MediaKey = `${TrackKind}:${number}` | `camera_matte:${number}`;

export function mediaKey(kind: TrackKind, segment: number): MediaKey {
  return `${kind}:${segment}`;
}

export function matteKey(segment: number): MediaKey {
  return `camera_matte:${segment}`;
}

/**
 * The segment covering a moment in source time, or null.
 *
 * Half-open, so a seam belongs to the later take — which is what makes the join
 * land on a frame rather than between two takes.
 *
 * Past every edge the tolerance applies, and it applies *forwards first*: where
 * a moment sits between two segments, the one about to start wins. A recording
 * extended with a second take has one camera gap per seam, because take two's
 * camera opens a couple of hundred milliseconds after take two's screen, and
 * holding take one's last camera frame across it would show the wrong take's
 * face over the new footage. Behind that, holding the previous segment's last
 * frame is what already happens for a camera that stopped a little early.
 *
 * **The tolerance may not cross a seam.** It closes the gap a device leaves at
 * the edges of its own take, and `take` is what says where that take ends —
 * from `takeAt`, never from a segment boundary, because those disagree per
 * track by however long each device took to open. Without it every track in a
 * recording extended once reaches across the join: a screen that stopped ten
 * milliseconds early is ten milliseconds inside the tolerance, so the last
 * frames of a clip come out of the *next* take's file, and a take with no
 * camera of its own — an imported video — borrows the previous take's face for
 * the whole of its length. Both read as footage rather than as a bug.
 *
 * Omitted, the lookup is what it was: a recording with one take has no seam to
 * respect.
 *
 * `segments` must be in clock order, which is how the manifest writes them.
 */
export function segmentAt<T extends TrackMedia>(
  segments: readonly T[],
  source: MediaTime,
  take?: { start: MediaTime; end: MediaTime } | null,
): T | null {
  let before: T | null = null;

  for (const segment of segments) {
    // Which take wrote a segment is decided by where it begins, and a segment
    // another take wrote is not an answer to this moment at all — not as the
    // one ahead, not as the one behind, and not even where it overran far
    // enough to cover the moment outright. Skipped rather than weighed, so
    // every rule below reads as it did against the take's own files.
    if (take && (segment.offset < take.start || segment.offset >= take.end)) continue;

    const end = segment.offset + segment.duration;
    if (source >= segment.offset && source < end) return segment;

    // In clock order, so the first segment starting after this moment is the
    // nearest one ahead. Anything past it is further away still.
    if (segment.offset > source) {
      return segment.offset - source <= EDGE_TOLERANCE ? segment : before;
    }

    before = source - end <= EDGE_TOLERANCE ? segment : null;
  }

  return before;
}

/** Every segment of one kind, in clock order. */
export function segmentsOf<T extends TrackMedia>(media: readonly T[], kind: TrackKind): T[] {
  return media.filter((track) => track.kind === kind);
}

/**
 * The kinds a recording has media for, once rather than once per segment.
 *
 * What decides which panels and timeline rows the editor shows — a question
 * about the recording, never about one of its takes.
 */
export function kindsOf(media: readonly TrackMedia[]): Set<TrackKind> {
  return new Set(media.map((track) => track.kind));
}
