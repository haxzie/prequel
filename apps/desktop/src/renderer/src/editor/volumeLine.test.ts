/**
 * The volume line's arithmetic.
 *
 * The one that matters is `scaledAudio`: a clip has two track volumes and the
 * line has one position, and the wrong answer — setting both to the dragged
 * level — silently flattens a balance somebody set by hand. Nothing fails, the
 * export is simply mixed differently from the way it was left.
 */
import { describe, expect, it } from "vitest";

import { levelAt, levelY, MAX_LEVEL, scaledAudio, waveHeight } from "./volumeLine";

describe("where the line sits", () => {
  it("puts unity halfway up the bar", () => {
    expect(levelY(1)).toBeCloseTo(0.5);
  });

  it("puts silence on the floor and the ceiling at the top", () => {
    expect(levelY(0)).toBe(1);
    expect(levelY(MAX_LEVEL)).toBe(0);
  });

  it("round-trips a drag", () => {
    for (const level of [0, 0.25, 1, 1.75, MAX_LEVEL]) {
      expect(levelAt(levelY(level))).toBeCloseTo(level);
    }
  });

  it("holds a drag that runs off either end of the bar", () => {
    expect(levelAt(-3)).toBe(MAX_LEVEL);
    expect(levelAt(4)).toBe(0);
  });
});

describe("scaling a clip's two tracks", () => {
  it("keeps the balance between them", () => {
    // A voice at full over system audio at a quarter, pulled down to half.
    const { mic, system } = scaledAudio(1, 0.25, 0.5);

    expect(mic).toBeCloseTo(0.5);
    expect(system).toBeCloseTo(0.125);
  });

  it("lands the louder of the two on the level asked for", () => {
    const { mic, system } = scaledAudio(0.4, 0.8, 1.6);

    expect(Math.max(mic, system)).toBeCloseTo(1.6);
    expect(mic).toBeCloseTo(0.8);
  });

  it("leaves a track that was muted on purpose at zero", () => {
    const { mic, system } = scaledAudio(1, 0, 0.5);

    expect(mic).toBeCloseTo(0.5);
    expect(system).toBe(0);
  });

  it("brings a clip silenced by hand back from the line", () => {
    // No ratio to keep, so the level applies to both — or a clip pulled to
    // the floor could never be dragged back up again.
    expect(scaledAudio(0, 0, 0.75)).toEqual({ mic: 0.75, system: 0.75 });
  });

  it("never scales past the ceiling", () => {
    const { mic, system } = scaledAudio(1, 1, 99);

    expect(mic).toBe(MAX_LEVEL);
    expect(system).toBe(MAX_LEVEL);
  });
});

describe("the wave under the line", () => {
  it("fills exactly the room below it", () => {
    // The two have to agree, or the bar says one thing with its line and
    // another with the shape under it.
    for (const level of [0, 0.5, 1, 1.5, MAX_LEVEL]) {
      expect(waveHeight(level) / 100).toBeCloseTo(1 - levelY(level));
    }
  });

  it("has no height at silence and the whole bar at the ceiling", () => {
    expect(waveHeight(0)).toBe(0);
    expect(waveHeight(MAX_LEVEL)).toBe(100);
    expect(waveHeight(1)).toBeCloseTo(50);
  });
});
