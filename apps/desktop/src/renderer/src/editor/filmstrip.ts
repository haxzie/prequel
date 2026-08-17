/**
 * Laying frame thumbnails along a clip.
 *
 * The sheet is extracted once per recording at a fixed cadence and indexed by
 * *source* time — the same choice the waveform peaks make, and for the same
 * reason: a cut must not move or invalidate them. Zooming then picks a stride
 * through the sheet rather than extracting again, so dragging the zoom is
 * arithmetic and never a decode.
 *
 * Every function here is pure, so the layout can be tested without a video
 * element, a canvas or a recording.
 */
import type { MediaTime } from "../../../shared/manifest";

const NS_PER_SECOND = 1_000_000_000;

/** How wide one thumbnail is drawn, in CSS pixels. */
export const THUMB_WIDTH = 48;

/**
 * How many frames the sheet holds at most.
 *
 * A ten-minute take at one frame a second is 600 thumbnails; at 48px wide and
 * 16:9 that is a 28,800px sheet, past the 16,384px limit Chromium puts on a
 * canvas dimension. Capping the count and stretching the interval keeps one
 * recording to one sheet, which is what makes drawing it a single upload.
 */
export const MAX_FRAMES = 240;

/** Shortest gap worth extracting. Below this the strip repeats itself. */
const MIN_INTERVAL: MediaTime = 250_000_000;

export interface Cadence {
  /** How many frames to extract. */
  count: number;
  /** Source-time gap between them. */
  interval: MediaTime;
}

/**
 * How often to grab a frame for a recording of this length.
 *
 * One a second while that fits under the cap, then as sparse as it needs to be.
 * A recording shorter than one interval still gets a single frame — a two-second
 * clip with no thumbnail at all reads as a broken strip rather than a short one.
 */
export function cadence(duration: MediaTime): Cadence {
  if (duration <= 0) return { count: 0, interval: 0 };

  const wanted = Math.ceil(duration / NS_PER_SECOND);
  const count = Math.max(1, Math.min(wanted, MAX_FRAMES));
  const interval = Math.max(MIN_INTERVAL, Math.ceil(duration / count));

  return { count, interval };
}

/**
 * The source time of frame `index` in a sheet.
 *
 * Half an interval in, so a thumbnail shows the middle of the stretch it stands
 * for rather than its first frame. On a cut that lands on a scene change, the
 * first frame is the one most likely to be the tail of the previous shot.
 */
export function frameTime(index: number, interval: MediaTime): MediaTime {
  return Math.round((index + 0.5) * interval);
}

/**
 * Which frame of the sheet best represents a moment in source time.
 *
 * Clamped rather than wrapped: a clip trimmed a hair past the last extracted
 * frame should hold the final thumbnail, not restart from the beginning.
 */
export function frameAt(source: MediaTime, cadence: Cadence): number {
  if (cadence.count <= 0 || cadence.interval <= 0) return 0;

  const index = Math.floor(source / cadence.interval);
  return Math.min(Math.max(index, 0), cadence.count - 1);
}

export interface Thumb {
  /** Offset from the clip's left edge, in CSS pixels. */
  x: number;
  /** Which frame of the sheet to show. */
  index: number;
}

/**
 * The thumbnails to draw across one clip.
 *
 * `widthPx` comes from the zoom — a clip's share of `contentWidth` — so this is
 * the one place the zoom level turns into a number of frames. Positions are
 * whole pixels: a sheet drawn at a fractional offset is resampled, and a
 * resampled thumbnail is a blurry one.
 *
 * The last thumbnail is allowed to overhang the clip's right edge, which the
 * clip's own `overflow-hidden` then clips. Stopping short instead would leave a
 * gap at the end of every clip whose width is not a whole multiple of a
 * thumbnail.
 */
export function thumbs(
  slice: { source: { start: MediaTime; end: MediaTime } },
  widthPx: number,
  cadence: Cadence,
): Thumb[] {
  if (widthPx <= 0 || cadence.count <= 0) return [];

  const span = slice.source.end - slice.source.start;
  if (span <= 0) return [];

  const columns = Math.ceil(widthPx / THUMB_WIDTH);
  const out: Thumb[] = [];

  for (let column = 0; column < columns; column += 1) {
    // The middle of this column, so a thumbnail represents what is under it
    // rather than what is at its left edge.
    const into = ((column + 0.5) * THUMB_WIDTH) / widthPx;
    const source = slice.source.start + into * span;

    out.push({ x: column * THUMB_WIDTH, index: frameAt(source, cadence) });
  }

  return out;
}
