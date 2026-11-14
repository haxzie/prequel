/**
 * A tile has to write something no other tile writes.
 *
 * `outputFrame` never upscales, so a size whose shorter edge is already past
 * the recording's resolves to the recording's own — the same picture Full
 * writes. The row offered both anyway: on a 14-inch capture at 3024×1964, 4K
 * and Full were byte for byte identical, two controls for one outcome, with
 * the warning under them naming the one that would have changed nothing.
 */
import { describe, expect, it } from "vitest";

import { cheaperThan, exportFrame, huge, offeredFor, QUALITIES, selectedIn } from "./quality";

/** Every capture these have to be right for, by what the recorder writes. */
const RETINA_14 = { width: 3024, height: 1964 };
const UHD = { width: 3840, height: 2160 };
const FIVE_K = { width: 5120, height: 2880 };
/** The frame in the two reports: a scaled 16-inch display, captured at 2x. */
const REPORTED = { width: 6014, height: 3074 };
const HD = { width: 1920, height: 1080 };

const labels = (source: { width: number; height: number }) =>
  offeredFor(source, QUALITIES).map((quality) => quality.label);

describe("the sizes a recording is offered", () => {
  it("drops one that would write the recording's own frame", () => {
    // The complaint, exactly: 4K is Full here, so only one of them is a choice.
    expect(labels(RETINA_14)).toEqual(["Full", "1080p", "720p", "480p"]);
    expect(labels(UHD)).toEqual(["Full", "1080p", "720p", "480p"]);
  });

  it("was already doing it before 4K existed", () => {
    // Full and 1080p are the same picture on an HD recording, and were offered
    // as two tiles for as long as the row has been there. Adding a size in the
    // middle of the range made the common case of a bug that was always here.
    expect(labels(HD)).toEqual(["Full", "720p", "480p"]);
  });

  it("keeps one that genuinely is smaller", () => {
    expect(labels(FIVE_K)).toEqual(["Full", "4K", "1080p", "720p", "480p"]);
    expect(labels(REPORTED)).toEqual(["Full", "4K", "1080p", "720p", "480p"]);
  });
});

describe("the warning under them", () => {
  const full = (source: { width: number; height: number }) => ({ ...source });

  it("stays quiet for anything a 4K tile could write", () => {
    // The number that matters: the line names a tile as the way out, and one
    // that stayed up after you took its advice would be worse than none.
    expect(huge(full(UHD))).toBe(false);
    expect(huge(full(RETINA_14))).toBe(false);
    // 4K on the reported frame is 1.96:1, so 4224×2160 — the widest a 4K
    // choice gets in practice, and still under.
    expect(huge({ width: 4224, height: 2160 })).toBe(false);
  });

  it("speaks for a frame that really will take hours", () => {
    expect(huge(full(REPORTED))).toBe(true);
    expect(huge(full(FIVE_K))).toBe(true);
  });

  it("names a tile that is on the row and is smaller", () => {
    // 4K on the reported frame, because that is the largest step down that
    // exists there.
    expect(cheaperThan(REPORTED, full(REPORTED), offeredFor(REPORTED, QUALITIES))).toBe("4K");
    // And 1080p where there is no 4K tile to point at.
    expect(cheaperThan(RETINA_14, full(RETINA_14), offeredFor(RETINA_14, QUALITIES))).toBe("1080p");
  });

  it("names nothing when the smallest is already chosen", () => {
    const tiny = { width: 640, height: 480 };
    expect(cheaperThan(tiny, full(tiny), offeredFor(tiny, QUALITIES))).toBeNull();
  });
});

describe("which tile is outlined", () => {
  it("lights Full for a setting that resolves to the recording's own frame", () => {
    // `DEFAULT_SHORT_EDGE` is 2160, and on this capture that is Full — so the
    // row has no 4K tile to match and would otherwise outline nothing at all.
    expect(selectedIn(RETINA_14, 2160, offeredFor(RETINA_14, QUALITIES))).toBe("full");
    expect(selectedIn(UHD, 2160, offeredFor(UHD, QUALITIES))).toBe("full");
  });

  it("lights 4K where 4K is a real choice", () => {
    expect(selectedIn(REPORTED, 2160, offeredFor(REPORTED, QUALITIES))).toBe("2160");
  });

  it("still lights the plain cases", () => {
    expect(selectedIn(REPORTED, null, offeredFor(REPORTED, QUALITIES))).toBe("full");
    expect(selectedIn(REPORTED, 1080, offeredFor(REPORTED, QUALITIES))).toBe("1080");
  });
});

describe("the frame an export is written at", () => {
  it("applies the row's setting to a video", () => {
    expect(exportFrame(REPORTED, 1080, false)).toEqual({ width: 2112, height: 1080 });
    expect(exportFrame(REPORTED, null, false)).toEqual({ width: 6014, height: 3074 });
  });

  it("ignores it entirely for a screenshot", () => {
    // The control is not on the sheet for a still, so nothing would reveal a
    // shrunk one: a PNG quietly written at whatever a video was last exported
    // at, with no row to show it and no way to change it.
    expect(exportFrame(REPORTED, 480, true)).toEqual({ width: 6014, height: 3074 });
    expect(exportFrame(RETINA_14, 1080, true)).toEqual({ width: 3024, height: 1964 });
    expect(exportFrame(RETINA_14, 2160, true)).toEqual({ width: 3024, height: 1964 });
  });
});
