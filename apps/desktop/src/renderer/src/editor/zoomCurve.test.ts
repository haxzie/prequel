/**
 * The shape drawn inside a zoom's bar.
 *
 * Three things are worth guarding, and all of them fail quietly. The bar has to
 * draw the zoom's whole life — the moves either side of the hold — or every
 * zoom is a flat line and the row says only "there is a zoom here". The height
 * has to be compressed, or the levels people actually use all sit in the bottom
 * sliver and the bar reads as flat anyway. And the area has to close on the
 * resting line rather than on the floor of the bar, or a 1x zoom, which is no
 * zoom at all, still wears a band.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_ZOOM, type ZoomSlice } from "../../../shared/project";
import { zoomEnvelope, zoomSpans } from "../../../shared/layout";
import { BAND, barCurve, zoomCeiling } from "./zoomCurve";

const S = 1_000_000_000;

const zoom = (over: Partial<ZoomSlice> = {}): ZoomSlice => ({
  ...DEFAULT_ZOOM,
  id: "z",
  source: { start: 2 * S, end: 6 * S },
  target: "region",
  x: 0.5,
  y: 0.5,
  ...over,
});

/** The shape a row of these zooms draws for the one at `index`. */
const shapeOf = (zooms: ZoomSlice[], index = 0) => {
  const envelope = zoomEnvelope(zooms);
  return barCurve(envelope, zoomSpans(zooms)[index]!, zoomCeiling(envelope));
};

/** Every y in a path, in order. */
const heights = (path: string) =>
  [...path.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((match) => Number(match[2]));

describe("zoomCeiling", () => {
  it("is the deepest zoom on the row, never less than a floor", () => {
    expect(
      zoomCeiling([
        { at: 0, level: 5 },
        { at: S, level: 3 },
      ]),
    ).toBe(5);
    // A row of ordinary shots is read against the floor, so the stock 2x has
    // somewhere left to go rather than filling its bar.
    expect(zoomCeiling([{ at: 0, level: 2 }])).toBe(4);
    expect(zoomCeiling([{ at: 0, level: 1.2 }])).toBe(4);
  });
});

describe("barCurve", () => {
  it("draws nothing without an envelope or without width", () => {
    expect(barCurve([], { from: 0, to: S }, 4)).toEqual({ line: "", area: "" });
    expect(barCurve([{ at: 0, level: 2 }], { from: S, to: S }, 4)).toEqual({ line: "", area: "" });
  });

  it("rises, holds and falls — the whole move, inside the bar", () => {
    const ys = heights(shapeOf([zoom({ level: 4 })]).line);
    const deepest = Math.min(...ys);

    // Both ends start from rest, which is the bottom of the band.
    expect(ys[0]).toBe(BAND.rest);
    expect(ys[ys.length - 1]).toBe(BAND.rest);
    // And the middle has arrived at the ceiling.
    expect(deepest).toBe(BAND.deepest);
    expect(ys[Math.floor(ys.length / 2)]).toBe(BAND.deepest);
  });

  it("gives a gentle zoom a shape rather than a sliver", () => {
    // The bug this exists for: read straight off the ratio, a 1.5x against a
    // ceiling of 4 came out a sixth of its bar and the whole thing looked flat.
    const ys = heights(shapeOf([zoom({ level: 1.5 })]).line);
    const climbed = (BAND.rest - Math.min(...ys)) / (BAND.rest - BAND.deepest);

    expect(climbed).toBeGreaterThan(0.35);
    // Still clearly short of a zoom that goes all the way in.
    expect(climbed).toBeLessThan(0.65);
  });

  it("orders levels, whatever the compression", () => {
    const climb = (level: number) => {
      const ys = heights(shapeOf([zoom({ level })]).line);
      return BAND.rest - Math.min(...ys);
    };

    expect(climb(3)).toBeGreaterThan(climb(2));
    expect(climb(2)).toBeGreaterThan(climb(1.5));
  });

  it("gives a slow zoom wider shoulders than a quick one", () => {
    // The proportions are the one thing the squeeze keeps: a zoom that spends
    // longer travelling spends more of its bar doing it.
    const shoulder = (speed: number) => {
      const ys = heights(shapeOf([zoom({ level: 4, speed })]).line);
      return ys.findIndex((y) => y === BAND.deepest);
    };

    expect(shoulder(1.5)).toBeGreaterThan(shoulder(0.3));
  });

  it("closes the area on the resting line, at both ends", () => {
    const { area } = shapeOf([zoom({ level: 3 })]);
    const ys = heights(area);

    expect(ys[0]).toBe(BAND.rest);
    expect(ys[ys.length - 1]).toBe(BAND.rest);
    expect(area.endsWith("Z")).toBe(true);
  });

  it("never returns to rest inside a zoom that morphs into its neighbour", () => {
    // They are one continuous move, so the first bar must not fall away at its
    // end: the picture is on its way to the next zoom, not back to rest.
    const pair = [
      zoom({ id: "a", source: { start: 2 * S, end: 3 * S }, level: 2 }),
      zoom({ id: "b", source: { start: 3.2 * S, end: 5 * S }, level: 4 }),
    ];
    const ys = heights(shapeOf(pair, 0).line);

    expect(ys[ys.length - 1]).toBeLessThan(BAND.rest);
  });
});
