/**
 * The judgement calls, made explicit.
 *
 * Every number in `autoedit.ts` is a taste decision, and taste decisions are
 * exactly the ones that get changed by someone who does not know what they were
 * balancing against. These say what each is for.
 */
import { describe, expect, it } from "vitest";

import { augmentZooms, autoZooms, type Moment } from "./autoedit.js";
import { DEFAULT_ZOOM, type ZoomSlice } from "./project.js";

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

  it("cuts a long run of clicking into shots rather than dropping it", () => {
    // This used to return nothing: a run past the cap was discarded whole. A
    // demo that is one continuous stream of clicks is the common case, and it
    // came back with no zooms at all — the automatic pass was quietest exactly
    // where the most was happening.
    const steady = Array.from({ length: 20 }, (_, index) => click(10 + index));
    const zooms = autoZooms(steady, OPTIONS);

    expect(zooms.length).toBeGreaterThan(1);

    for (const zoom of zooms) {
      // Still shots rather than one push over the whole run.
      expect(zoom.source.end - zoom.source.start).toBeLessThanOrEqual(20 * S);
    }
  });

  it("holds through a pause rather than pulling out and coming back", () => {
    // Two runs four seconds apart are one shot, not two. A zoom that leaves and
    // returns inside a few seconds is the most tiring thing an automatic edit
    // can do, and the camera can travel between the two places instead — which
    // it could not before it was allowed to pan.
    expect(autoZooms([click(10, 0.2, 0.2), click(14, 0.8, 0.8)], OPTIONS)).toHaveLength(1);
  });

  it("leaves room to breathe between the shots it does make", () => {
    // Anything closer reads as the picture flinching rather than as two shots.
    const zooms = autoZooms(
      Array.from({ length: 12 }, (_, index) => click(index * 7)),
      { duration: 120 * S, hasCursor: true },
    );

    expect(zooms.length).toBeGreaterThan(1);

    for (let index = 1; index < zooms.length; index += 1) {
      const gap = zooms[index]!.source.start - zooms[index - 1]!.source.end;
      expect(gap).toBeGreaterThanOrEqual(2 * S);
    }
  });

  it("holds each shot long enough to read", () => {
    // The complaint that started this: zooms that arrived and left before there
    // was anything to see. A push takes the best part of a second at each end,
    // so anything under about three is all travel and no dwell.
    for (const zoom of autoZooms([click(10), click(10.6)], OPTIONS)) {
      expect(zoom.source.end - zoom.source.start).toBeGreaterThanOrEqual(2.8 * S);
    }
  });

  it("stays on screen after the click, not just up to it", () => {
    // A viewer needs to see what the click *did*. Pulling out as it lands shows
    // the press and hides the result.
    const zooms = autoZooms([click(10)], OPTIONS);
    expect(zooms[0]!.source.end - 10 * S).toBeGreaterThanOrEqual(2 * S);
  });

  it("holds through a long stretch of typing", () => {
    // Filling in a form is one continuous act. Cutting away in the middle of it
    // and coming back is worse than either holding or never zooming.
    const filling = Array.from({ length: 20 }, (_, index) => typing(10 + index));
    const zooms = autoZooms(filling, OPTIONS);

    expect(zooms).toHaveLength(1);
    // Right to the last keystroke, not a couple of seconds at the start.
    expect(zooms[0]!.source.end).toBeGreaterThan(29 * S);
  });

  it("still lets go of a field left focused for the rest of the recording", () => {
    const forgotten = Array.from({ length: 90 }, (_, index) => typing(10 + index));
    expect(autoZooms(forgotten, { duration: 200 * S, hasCursor: true })).toEqual([]);
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

describe("running it again over an edit", () => {
  const existing = (from: number, to: number, over: Partial<ZoomSlice> = {}): ZoomSlice => ({
    // Spread first so a field added to a zoom later cannot break this fixture;
    // every value spelled out below still wins over the default.
    ...DEFAULT_ZOOM,
    id: "mine",
    source: { start: from * S, end: to * S },
    target: "region",
    x: 0.9,
    y: 0.1,
    level: 3,
    speed: 1,
    tilt: 20,
    yaw: -20,
    depth: 0.9,
    blur: true,
    blurSafe: 0.5,
    blurStrength: 0.02,
    ...over,
  });

  it("adds shots in the gaps without touching what is there", () => {
    const mine = existing(40, 45);
    const after = augmentZooms([mine], [click(10), click(10.6)], OPTIONS);

    // Byte for byte: not moved, not retargeted, not restyled.
    expect(after).toContainEqual(mine);
    expect(after.length).toBeGreaterThan(1);
  });

  it("extends a zoom it lands on rather than replacing it", () => {
    // The whole point. A hand-made shot carries settings nobody wants
    // regenerated, so a moment overlapping it grows the span and leaves the
    // rest. The clicks sit late enough that the candidate's lead-in reaches
    // back inside the existing shot.
    const mine = existing(10, 14);
    const after = augmentZooms([mine], [click(15), click(15.5)], OPTIONS);

    expect(after).toHaveLength(1);
    expect(after[0]!.source.start).toBe(mine.source.start);
    expect(after[0]!.source.end).toBeGreaterThan(mine.source.end);
    // Everything that is not the span survives.
    expect(after[0]!.level).toBe(3);
    expect(after[0]!.tilt).toBe(20);
    expect(after[0]!.blur).toBe(true);
  });

  it("never shrinks a zoom it lands inside", () => {
    const mine = existing(8, 30);
    const after = augmentZooms([mine], [click(15)], OPTIONS);

    expect(after).toEqual([mine]);
  });

  it("leaves a stretch that already carries two shots alone", () => {
    // Extending one would swallow the other, and two hand-made shots in a row
    // is not a stretch asking for a third opinion.
    const first = existing(10, 13, { id: "a" });
    const second = existing(14, 17, { id: "b" });

    // One cluster — a second apart, so they stay together — long enough that
    // the candidate it makes spans both shots.
    const run = [11, 12, 13, 14, 15].map((second_) => click(second_));
    const after = augmentZooms([first, second], run, OPTIONS);

    expect(after).toEqual([first, second]);
  });

  it("never produces an overlap", () => {
    // `sanitiseProject` drops one of an overlapping pair, so an overlap here is
    // a zoom that vanishes on the next save rather than a visible mistake.
    const mine = [existing(10, 13, { id: "a" }), existing(20, 23, { id: "b" })];
    const after = augmentZooms(
      mine,
      Array.from({ length: 30 }, (_, index) => click(index * 1.4)),
      OPTIONS,
    );

    for (let index = 1; index < after.length; index += 1) {
      expect(after[index]!.source.start).toBeGreaterThanOrEqual(after[index - 1]!.source.end);
    }
  });

  it("is idempotent", () => {
    // Pressing the button twice should not keep growing the same shots.
    const moments = [click(10), click(10.6), click(30), click(30.5)];
    const once = augmentZooms([], moments, OPTIONS);
    const twice = augmentZooms(once, moments, OPTIONS);

    expect(twice).toEqual(once);
  });
});
