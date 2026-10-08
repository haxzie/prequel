/**
 * The shape a clip draws for its audio.
 *
 * Two things here are worth guarding: a track that opened late has to be laid
 * on the session timeline at its offset — drawing it from zero puts the sound
 * ahead of the picture — and merging tracks must not turn overlapping speech
 * into a solid block.
 */
import { describe, expect, it } from "vitest";

import {
  BUCKETS_PER_SECOND,
  bucketCount,
  mergePeaks,
  normalised,
  placeOnSession,
  wavePath,
} from "./waveform";

const S = 1_000_000_000;

describe("bucketCount", () => {
  it("counts one bucket per slice of a second", () => {
    expect(bucketCount(10 * S)).toBe(10 * BUCKETS_PER_SECOND);
  });

  it("never returns nothing to draw into", () => {
    expect(bucketCount(0)).toBe(1);
  });
});

describe("normalised", () => {
  it("scales against the loudest, so a quiet take still shows", () => {
    const quiet = normalised(new Float32Array([0.05, 0.01, 0.025]), 3);
    expect(quiet[0]).toBeCloseTo(1);
    expect(quiet[1]).toBeCloseTo(0.2);
    expect(quiet[2]).toBeCloseTo(0.5);
  });

  it("leaves silence silent rather than amplifying nothing", () => {
    const peaks = normalised(new Float32Array(8), 8);
    expect([...peaks].every((value) => value === 0)).toBe(true);
  });

  it("sizes the result to the manifest, not to the file", () => {
    // AAC pads the end of a file by a frame; the manifest's duration is what
    // the rest of the timeline places the track by.
    expect(normalised(new Float32Array([1, 1, 1]), 2)).toHaveLength(2);
    const padded = normalised(new Float32Array([1]), 4);
    expect(padded).toHaveLength(4);
    expect(padded[0]).toBe(1);
    expect(padded[3]).toBe(0);
  });

  it("has nothing to say about an empty track", () => {
    expect(normalised(new Float32Array(), 8)).toHaveLength(8);
    expect(normalised(new Float32Array([1]), 0)).toHaveLength(0);
  });
});

describe("placeOnSession", () => {
  it("starts a late track at its offset", () => {
    // The camera's audio opens a few hundred ms in. Drawing it from zero puts
    // the sound ahead of the picture it belongs to.
    const placed = placeOnSession(new Float32Array([1, 1]), 1 * S, 10 * BUCKETS_PER_SECOND);

    expect(placed[0]).toBe(0);
    expect(placed[BUCKETS_PER_SECOND]).toBe(1);
    expect(placed[BUCKETS_PER_SECOND + 1]).toBe(1);
  });

  it("passes a track that anchored the clock straight through", () => {
    const placed = placeOnSession(new Float32Array([0.5, 0.25]), 0, 4);
    expect([...placed]).toEqual([0.5, 0.25, 0, 0]);
  });

  it("drops anything that would fall off the end", () => {
    // A track longer than the edit, after trimming. Writing past the array is
    // the kind of thing that throws in a loop nobody is watching.
    expect(() => placeOnSession(new Float32Array([1, 1, 1]), 0, 2)).not.toThrow();
    expect(placeOnSession(new Float32Array([1, 1, 1]), 0, 2)).toHaveLength(2);
  });
});

describe("mergePeaks", () => {
  it("takes the loudest track at each moment", () => {
    // Not the sum: two half-volume tracks are not one at full, and summing
    // turns any overlap into a solid block.
    const merged = mergePeaks([new Float32Array([0.5, 0.5, 0]), new Float32Array([0.2, 0.9, 0])]);

    // Compared loosely: `Float32Array` rounds 0.9 to 0.8999999761581421, which
    // is the storage being single-precision rather than the merge being wrong.
    expect(merged[0]).toBeCloseTo(0.5);
    expect(merged[1]).toBeCloseTo(0.9);
    expect(merged[2]).toBe(0);
  });

  it("stretches to the longest track", () => {
    const merged = mergePeaks([new Float32Array([1]), new Float32Array([0, 0, 1])]);
    expect([...merged]).toEqual([1, 0, 1]);
  });

  it("has nothing to merge when there is no audio", () => {
    expect(mergePeaks([])).toHaveLength(0);
  });
});

describe("wavePath", () => {
  const peaks = Float32Array.from({ length: 200 }, (_, index) => (index % 10) / 10);

  it("draws a closed shape in a unit box", () => {
    const path = wavePath(peaks, 0, 5 * S);

    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);

    // Everything inside 0-1 on both axes, so the SVG can stretch it to any
    // clip size without the path ever leaving the box.
    for (const [x, y] of [...path.matchAll(/(\d\.\d+),(\d\.\d+)/g)].map((m) => [+m[1]!, +m[2]!])) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("stands on the bottom edge", () => {
    // One-sided, growing upwards from the clip's floor: it opens and closes on
    // `y = 1` and nothing ever dips below it.
    const path = wavePath(peaks, 0, 5 * S);
    const ys = [...path.matchAll(/,(\d\.\d+)/g)].map((match) => +match[1]!);

    expect(path.startsWith("M0.0000,1.0000")).toBe(true);
    expect(path.endsWith("L1.0000,1.0000Z")).toBe(true);
    expect(Math.max(...ys)).toBe(1);
  });

  it("is drawn as curves rather than corners", () => {
    expect(wavePath(peaks, 0, 5 * S)).toContain("Q");
  });

  it("keeps a floor, so a quiet passage still reads as a track", () => {
    const path = wavePath(new Float32Array(100), 0, 5 * S);
    const ys = [...path.matchAll(/,(\d\.\d+)/g)].map((match) => +match[1]!);

    // Silence draws a thin band along the bottom rather than nothing at all.
    expect(Math.min(...ys)).toBeLessThan(1);
    expect(Math.min(...ys)).toBeGreaterThan(0.9);
  });

  it("rounds a lone spike into its neighbours without losing it", () => {
    // The smoothing pass is there to soften a single loud bucket, not to
    // average it away — a consonant has to still lift the wave.
    const spike = new Float32Array(160);
    spike[80] = 1;

    const ys = [...wavePath(spike, 0, 8 * S).matchAll(/,(\d\.\d+)/g)].map((match) => +match[1]!);
    const tallest = 1 - Math.min(...ys);

    expect(tallest).toBeGreaterThan(0.4);
    expect(tallest).toBeLessThan(1);
  });

  it("reads only the span asked for", () => {
    // A clip shows its own slice of the recording, not the whole thing.
    const loudLate = new Float32Array(200);
    loudLate.fill(1, 100);

    expect(wavePath(loudLate, 0, 1 * S)).not.toBe(wavePath(loudLate, 8 * S, 9 * S));
  });

  it("caps its detail however long the span", () => {
    const long = new Float32Array(200_000);
    const points = [...wavePath(long, 0, 10_000 * S).matchAll(/Q/g)].length;

    expect(points).toBeLessThan(1000);
  });

  it("has nothing to draw for an empty span or no audio", () => {
    expect(wavePath(peaks, 5 * S, 5 * S)).toBe("");
    expect(wavePath(peaks, 5 * S, 1 * S)).toBe("");
    expect(wavePath(new Float32Array(), 0, 5 * S)).toBe("");
  });
});
