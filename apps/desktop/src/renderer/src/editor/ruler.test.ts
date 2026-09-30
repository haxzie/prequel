/**
 * The ruler has to stay readable at both ends of the zoom range.
 *
 * A tick per second is a grey smear on a ten-minute take; a tick per minute is
 * useless when placing a cut on a frame. Neither is a crash, so only a test
 * catches the ladder picking wrong.
 */
import { describe, expect, it } from "vitest";

import { fitZoom, formatTick, openingZoom, tickInterval, ticks } from "./ruler";

const S = 1_000_000_000;

describe("tickInterval", () => {
  it("uses a coarse interval when zoomed out", () => {
    // 2 px per second: a one-second tick would be 2 px apart.
    expect(tickInterval(2)).toBeGreaterThanOrEqual(30);
  });

  it("uses a fine interval when zoomed in", () => {
    // 400 px per second — a cut is being placed on a frame.
    expect(tickInterval(400)).toBeLessThanOrEqual(0.5);
  });

  it("always leaves room for a label", () => {
    // The property that matters: whatever the zoom, two labels never collide.
    for (const pxPerSecond of [0.5, 1, 3, 8, 20, 50, 120, 300, 1000]) {
      expect(tickInterval(pxPerSecond) * pxPerSecond).toBeGreaterThanOrEqual(68);
    }
  });

  it("falls back to the coarsest interval rather than dividing by zero", () => {
    expect(tickInterval(0)).toBe(3600);
    expect(tickInterval(-5)).toBe(3600);
    expect(tickInterval(Number.NaN)).toBe(3600);
  });
});

describe("ticks", () => {
  it("puts a major on every fifth tick", () => {
    const out = ticks(10 * S, 100);
    const majors = out.filter((tick) => tick.major);

    expect(majors.length).toBeGreaterThan(1);
    // Every major carries a label; no minor does.
    expect(majors.every((tick) => tick.label !== undefined)).toBe(true);
    expect(out.filter((tick) => !tick.major).every((tick) => tick.label === undefined)).toBe(true);
  });

  it("starts at zero and never runs past the edit", () => {
    const out = ticks(10 * S, 60);

    expect(out[0]!.at).toBe(0);
    expect(out.at(-1)!.at).toBeLessThanOrEqual(10 * S);
  });

  it("stays exact on a long take", () => {
    // Accumulating a float per tick drifts; ten minutes is enough for it to
    // show up as a label sitting off its own line.
    const out = ticks(600 * S, 4);
    const majors = out.filter((tick) => tick.major);

    for (const [index, tick] of majors.entries()) {
      expect(tick.at).toBe(index * tickInterval(4) * S);
    }
  });

  it("has nothing to draw for an empty edit", () => {
    expect(ticks(0, 100)).toEqual([]);
    expect(ticks(10 * S, 0)).toEqual([]);
  });
});

describe("formatTick", () => {
  it("shows minutes even for a short take", () => {
    // `0:05` rather than `5`, so it cannot be read as five minutes.
    expect(formatTick(5, 1)).toBe("0:05");
    expect(formatTick(65, 5)).toBe("1:05");
  });

  it("adds a decimal only when the interval needs one", () => {
    // Sub-second ticks would otherwise all label as the same whole second.
    expect(formatTick(1.5, 0.5)).toBe("0:01.5");
    expect(formatTick(90, 30)).toBe("1:30");
  });
});

describe("fitZoom", () => {
  it("fits the whole edit into the width", () => {
    expect(fitZoom(10 * S, 800)).toBe(80);
  });

  it("survives an empty edit rather than dividing by zero", () => {
    expect(fitZoom(0, 800)).toBe(1);
    expect(fitZoom(10 * S, 0)).toBe(1);
  });

  it("always leaves the ruler something to draw", () => {
    // Fit is the zoom the strip clamps to, so if the ruler can come out empty
    // at any of these the timeline shows a full-width strip under a blank
    // ruler — which is what it did while zooming out below fit was allowed.
    for (const seconds of [1, 5, 5.43, 30, 90, 600, 3600, 10_000]) {
      for (const width of [200, 640, 1400, 2400]) {
        const marks = ticks(seconds * S, fitZoom(seconds * S, width));

        expect(marks.length).toBeGreaterThan(2);
        expect(marks.filter((mark) => mark.label !== undefined).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("openingZoom", () => {
  /** Two `w-3` grips — `HANDLE_ROOM` in `TimelineStrip`. */
  const GRIPS = 24;
  /** Both grips and a strip of bar between them — `GRAB_ROOM`. */
  const GRAB = GRIPS + 12;
  /** The shortest shot the first cut makes — `MIN_SPAN` in `autoedit.ts`. */
  const SHORTEST = 2.8;
  /** `OPENING_ZOOM`, derived the same way. */
  const FLOOR = GRAB / SHORTEST;

  it("opens a short recording whole", () => {
    // Nothing is gained by holding room open past the end of the edit, so an
    // edit that already reads at the fit zoom still opens fitted.
    for (const seconds of [3, 20, 60]) {
      expect(openingZoom(seconds * S, 1100, FLOOR)).toBe(fitZoom(seconds * S, 1100));
    }
  });

  it("leaves the shortest automatic zoom room for both its grips", () => {
    // The failure this exists for: fitted, an eight-minute recording drew every
    // zoom narrower than the two handles on it, so the press landed on the end
    // grip rather than on the bar and the drag trimmed instead of moving.
    // Checked at every width the editor opens at, including a narrow window
    // with the inspector out, and at lengths well past anyone's patience.
    // Strictly greater: a bar exactly as wide as its grips has no middle left
    // to press, which is the failure arrived at from a pixel further out.
    for (const width of [640, 900, 1100, 1600, 2400]) {
      for (const seconds of [90, 500, 1800, 7200]) {
        const room = SHORTEST * openingZoom(seconds * S, width, FLOOR);

        expect(room).toBeGreaterThan(GRIPS);
      }
    }
  });

  it("never opens finer than the strip can be zoomed out to", () => {
    // `pxPerSecond` clamps the opening scale up to `fit`, so an opening zoom
    // below it would be discarded — and a floor that only ever applied to long
    // recordings would be silently doing nothing on short ones.
    for (const seconds of [1, 30, 498]) {
      expect(openingZoom(seconds * S, 1100, FLOOR)).toBeGreaterThanOrEqual(
        Math.min(fitZoom(seconds * S, 1100), FLOOR),
      );
    }
  });
});
