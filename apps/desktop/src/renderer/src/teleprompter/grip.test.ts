import { describe, expect, it } from "vitest";

import { TELEPROMPTER_MAX_LINES, TELEPROMPTER_MIN_LINES } from "../../../shared/contract";
import { clampLines, linesFromDrag } from "./grip";

const LINE = 27;

describe("linesFromDrag", () => {
  it("drags down for taller and up for shorter", () => {
    // The direction is the whole gesture. Backwards, the panel shrinks as the
    // hand pulls it open — which reads as the handle being broken rather than
    // as being the wrong way round.
    expect(linesFromDrag(4, LINE * 2, LINE)).toBe(6);
    expect(linesFromDrag(4, -LINE * 2, LINE)).toBe(2);
  });

  it("holds still until the pointer has crossed half a line", () => {
    // Snapped to whole lines, so a hand that has barely moved must not flicker
    // the panel between two heights.
    expect(linesFromDrag(4, 0, LINE)).toBe(4);
    expect(linesFromDrag(4, LINE * 0.4, LINE)).toBe(4);
    expect(linesFromDrag(4, LINE * 0.6, LINE)).toBe(5);
  });

  it("never goes past either end, however far the drag runs", () => {
    // A drag carries on past the panel — the pointer is captured — so the
    // clamp is what stops an island taller than the window it is drawn in.
    expect(linesFromDrag(4, 4000, LINE)).toBe(TELEPROMPTER_MAX_LINES);
    expect(linesFromDrag(4, -4000, LINE)).toBe(TELEPROMPTER_MIN_LINES);
  });

  it("measures in lines, not pixels, so a bigger text drags the same", () => {
    // The reader is choosing how much script to see. Two lines is two lines
    // whether the text is small or large, even though the panel grows by
    // different amounts.
    expect(linesFromDrag(3, 18 * 1.35 * 2, 18 * 1.35)).toBe(5);
    expect(linesFromDrag(3, 24 * 1.35 * 2, 24 * 1.35)).toBe(5);
  });

  it("holds its ground rather than producing a height nothing can draw", () => {
    expect(linesFromDrag(5, 100, 0)).toBe(5);
    expect(linesFromDrag(5, Number.NaN, LINE)).toBe(TELEPROMPTER_MIN_LINES);
  });
});

describe("clampLines", () => {
  it("rounds a half line rather than carrying it", () => {
    expect(clampLines(4.5)).toBe(5);
    expect(clampLines(4.4)).toBe(4);
  });
});
