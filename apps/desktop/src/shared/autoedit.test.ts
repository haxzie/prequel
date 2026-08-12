/**
 * The judgement calls, made explicit.
 *
 * Every number in `autoedit.ts` is a taste decision, and taste decisions are
 * exactly the ones that get changed by someone who does not know what they were
 * balancing against. These say what each is for.
 */
import { describe, expect, it } from "vitest";

import { autoZooms, type Moment } from "./autoedit.js";

const S = 1_000_000_000;
const OPTIONS = { duration: 60 * S, hasCursor: true };

const click = (seconds: number, x = 0.5, y = 0.5): Moment => ({
  at: seconds * S,
  x,
  y,
  kind: "click",
});

const typing = (seconds: number, x = 0.5, y = 0.5): Moment => ({
  at: seconds * S,
  x,
  y,
  kind: "typing",
});

describe("clustering", () => {
  it("makes nothing from nothing", () => {
    // The right answer for a recording of someone reading, and better than
    // inventing movement to justify the feature.
    expect(autoZooms([], OPTIONS)).toEqual([]);
  });

  it("gathers a run of clicks into one zoom", () => {
    // Clicking through a menu is one action. Four zooms fighting each other is
    // what makes automatic editing unusable.
    const zooms = autoZooms([click(10), click(10.6), click(11.1), click(11.7)], OPTIONS);

    expect(zooms).toHaveLength(1);
    expect(zooms[0]!.source.start).toBeLessThan(10 * S);
    expect(zooms[0]!.source.end).toBeGreaterThan(11.7 * S);
  });

  it("separates things that happened at different times", () => {
    expect(autoZooms([click(5), click(30)], OPTIONS)).toHaveLength(2);
  });

  it("keeps a cluster together even when it moves across the screen", () => {
    // A menu and the item it opens are in two places and are one action.
    // Splitting on distance would cut it in half.
    expect(autoZooms([click(10, 0.1, 0.1), click(10.8, 0.8, 0.7)], OPTIONS)).toHaveLength(1);
  });

  it("never overlaps two zooms", () => {
    // The one state the renderer has no answer for. Made unreachable here
    // rather than dropped later, because dropping loses the zoom silently.
    const zooms = autoZooms(
      Array.from({ length: 40 }, (_, index) => click(index * 1.9)),
      OPTIONS,
    );

    for (let index = 1; index < zooms.length; index += 1) {
      expect(zooms[index]!.source.start).toBeGreaterThanOrEqual(zooms[index - 1]!.source.end);
    }
  });

  it("stays inside the recording", () => {
    const zooms = autoZooms([click(0.1), click(0.4)], { duration: 3 * S, hasCursor: true });

    for (const zoom of zooms) {
      expect(zoom.source.start).toBeGreaterThanOrEqual(0);
      expect(zoom.source.end).toBeLessThanOrEqual(3 * S);
    }
  });

  it("declines a cluster too long to be a shot", () => {
    // Twenty seconds of steady clicking is the whole video, not a moment in it.
    const steady = Array.from({ length: 20 }, (_, index) => click(10 + index));
    expect(autoZooms(steady, OPTIONS)).toEqual([]);
  });
});

describe("what a zoom follows", () => {
  it("frames the field when the cluster is mostly typing", () => {
    expect(autoZooms([typing(10), typing(10.5), click(10.8)], OPTIONS)[0]!.target).toBe("typing");
  });

  it("follows the pointer for a run of clicks", () => {
    // Where the next one will be, which a fixed region cannot know.
    expect(autoZooms([click(10), click(10.6)], OPTIONS)[0]!.target).toBe("cursor");
  });

  it("holds a fixed region when there is no pointer track", () => {
    // A `cursor` zoom with nothing to follow would sit in the middle of the
    // frame for the whole span.
    const zooms = autoZooms([click(10, 0.2, 0.3)], { ...OPTIONS, hasCursor: false });

    expect(zooms[0]!.target).toBe("region");
    expect(zooms[0]!.x).toBeCloseTo(0.2);
    expect(zooms[0]!.y).toBeCloseTo(0.3);
  });
});

describe("how far in", () => {
  it("pushes closer on a tight cluster than a scattered one", () => {
    const tight = autoZooms([click(10, 0.5, 0.5), click(10.5, 0.52, 0.51)], OPTIONS);
    const scattered = autoZooms([click(10, 0.1, 0.1), click(10.5, 0.9, 0.9)], OPTIONS);

    expect(tight[0]!.level).toBeGreaterThan(scattered[0]!.level);
  });

  it("never pushes so far that the shot is all travel", () => {
    const scattered = autoZooms([click(10, 0, 0), click(10.5, 1, 1)], OPTIONS);
    expect(scattered[0]!.level).toBeLessThan(1.6);
  });
});

describe("the lean", () => {
  it("stays flat through the middle", () => {
    // A tilt on every zoom is a wobble, not a style.
    const zooms = autoZooms([click(10, 0.5, 0.5)], OPTIONS);

    expect(zooms[0]!.yaw).toBe(0);
    expect(zooms[0]!.tilt).toBe(0);
  });

  it("leans towards what it is showing, not away from it", () => {
    // Something on the right yaws positively, which swings the right edge back
    // — the picture turns to face it.
    expect(autoZooms([click(10, 0.95, 0.5)], OPTIONS)[0]!.yaw).toBeGreaterThan(0);
    expect(autoZooms([click(10, 0.05, 0.5)], OPTIONS)[0]!.yaw).toBeLessThan(0);
  });

  it("leans harder at the edges than just off centre", () => {
    // Cubed rather than linear, or everything tilts slightly and nothing reads
    // as deliberate.
    const edge = Math.abs(autoZooms([click(10, 1, 0.5)], OPTIONS)[0]!.yaw);
    const nearMiddle = Math.abs(autoZooms([click(10, 0.65, 0.5)], OPTIONS)[0]!.yaw);

    expect(edge).toBeGreaterThan(nearMiddle * 4);
  });

  it("keeps every angle small enough to read through", () => {
    // This runs on every recording without being asked. Something that
    // announces itself that often stops being cinematic very quickly.
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ]) {
      const zoom = autoZooms([click(10, x, y)], OPTIONS)[0]!;

      expect(Math.abs(zoom.yaw)).toBeLessThanOrEqual(12);
      expect(Math.abs(zoom.tilt)).toBeLessThanOrEqual(8);
    }
  });
});
