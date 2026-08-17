/**
 * Laying a sprite sheet along a clip.
 *
 * The properties that matter are the ones whose failure looks plausible: a strip
 * that repeats one frame, a strip that shifts when a clip is trimmed, and a
 * sheet wider than a canvas can be — which produces no error, just a blank
 * image.
 */
import { describe, expect, it } from "vitest";

import { cadence, frameAt, frameTime, MAX_FRAMES, THUMB_WIDTH, thumbs } from "./filmstrip";

const S = 1_000_000_000;

/** A clip covering a source span, which is all `thumbs` reads. */
const clip = (start: number, end: number) => ({ source: { start, end } });

describe("cadence", () => {
  it("takes about one frame a second for a short take", () => {
    const { count, interval } = cadence(30 * S);

    expect(count).toBe(30);
    expect(interval).toBe(S);
  });

  it("never asks for more frames than a canvas can hold", () => {
    // An hour at one a second would be 3600 cells — 172,800px wide, well past
    // Chromium's 16,384px limit, where `toDataURL` returns a blank image rather
    // than failing.
    const { count } = cadence(3600 * S);

    expect(count).toBe(MAX_FRAMES);
    expect(count * THUMB_WIDTH).toBeLessThan(16_384);
  });

  it("stretches the interval to cover the whole take once capped", () => {
    const { count, interval } = cadence(3600 * S);

    // The last frame's time must still land inside the recording.
    expect(frameTime(count - 1, interval)).toBeLessThan(3600 * S);
    // And the frames must between them span it, or the strip stops early.
    expect(count * interval).toBeGreaterThanOrEqual(3600 * S);
  });

  it("still gives one frame to a take shorter than the interval", () => {
    // A two-second clip with no thumbnail reads as a broken strip.
    expect(cadence(2 * S).count).toBeGreaterThanOrEqual(1);
  });

  it("asks for nothing when there is no recording", () => {
    expect(cadence(0)).toEqual({ count: 0, interval: 0 });
  });
});

describe("frameAt", () => {
  it("holds the last frame past the end rather than wrapping to the first", () => {
    // A clip trimmed a hair beyond the last extracted frame should show the end
    // of the recording. Wrapping would put its opening frame at its close.
    const plan = cadence(10 * S);

    expect(frameAt(999 * S, plan)).toBe(plan.count - 1);
    expect(frameAt(-5 * S, plan)).toBe(0);
  });
});

describe("thumbs", () => {
  it("fills the clip's width, allowing the last cell to overhang", () => {
    // Stopping short would leave a gap at the end of every clip whose width is
    // not a whole multiple of a cell.
    const strip = thumbs(clip(0, 10 * S), 100, cadence(10 * S));

    expect(strip).toHaveLength(Math.ceil(100 / THUMB_WIDTH));
    expect(strip.at(-1)!.x + THUMB_WIDTH).toBeGreaterThanOrEqual(100);
  });

  it("steps whole pixels, so no cell is resampled", () => {
    for (const thumb of thumbs(clip(0, 10 * S), 200, cadence(10 * S))) {
      expect(Number.isInteger(thumb.x)).toBe(true);
    }
  });

  it("shows more frames as the zoom widens the clip", () => {
    // The whole point: zoom changes the number of cells and nothing else.
    const plan = cadence(60 * S);
    const narrow = thumbs(clip(0, 60 * S), 200, plan);
    const wide = thumbs(clip(0, 60 * S), 800, plan);

    expect(wide.length).toBeGreaterThan(narrow.length);
    // And a wider clip must show a greater variety, not the same frame repeated.
    expect(new Set(wide.map((t) => t.index)).size).toBeGreaterThan(
      new Set(narrow.map((t) => t.index)).size,
    );
  });

  it("advances through the sheet across the clip", () => {
    const strip = thumbs(clip(0, 60 * S), 600, cadence(60 * S));
    const indexes = strip.map((t) => t.index);

    // Monotonic: a strip that jumped back and forth would read as scrubbed.
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(indexes.at(-1)!).toBeGreaterThan(indexes[0]!);
  });

  it("reads its own span, so a trimmed clip keeps the frames under it", () => {
    // The sheet is indexed by source time. A clip covering the second half of
    // the take must start half way through the sheet, wherever it sits in the
    // edit — this is what stops a cut shifting every thumbnail.
    const plan = cadence(60 * S);
    const second = thumbs(clip(30 * S, 60 * S), 300, plan);

    expect(second[0]!.index).toBeGreaterThanOrEqual(frameAt(30 * S, plan));
  });

  it("draws nothing without a sheet or a width", () => {
    expect(thumbs(clip(0, 10 * S), 0, cadence(10 * S))).toEqual([]);
    expect(thumbs(clip(0, 10 * S), 100, { count: 0, interval: 0 })).toEqual([]);
    // A zero-length span cannot be sampled.
    expect(thumbs(clip(5 * S, 5 * S), 100, cadence(10 * S))).toEqual([]);
  });
});
