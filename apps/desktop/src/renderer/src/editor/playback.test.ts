/**
 * The clock the playhead is drawn from.
 *
 * The jitter this covers was not a drawing problem. The loop sampled
 * `performance.now()` inside its callback — when the callback happened to run —
 * while painting on the display's even cadence. Even motion demands an even
 * clock, and `requestAnimationFrame` already hands one to its callback.
 */
import { describe, expect, it } from "vitest";

import { Playback } from "./playback";

const S = 1_000_000_000;
const MS = 1_000_000;

/** A playback anchored at a known wall time, so every read is deterministic. */
function playing(at = 0): { playback: Playback; started: number } {
  const playback = new Playback();
  playback.setDuration(10 * S);

  const started = performance.now();
  playback.seek(at);
  playback.play();

  return { playback, started };
}

describe("position", () => {
  it("advances by exactly the time it is given", () => {
    const { playback, started } = playing();

    // A second of wall time is a second of media, whenever it is asked for.
    expect(playback.position(started + 1000)).toBeCloseTo(S, -6);
    expect(playback.position(started + 2000)).toBeCloseTo(2 * S, -6);
  });

  it("moves in even steps for even timestamps", () => {
    // The property the smoothness depends on: equal gaps in, equal gaps out.
    // Uneven steps here are exactly what a viewer reads as judder.
    const { playback, started } = playing();

    const frame = 1000 / 60;
    const positions = Array.from({ length: 12 }, (_, index) =>
      playback.position(started + index * frame),
    );

    const steps = positions.slice(1).map((value, index) => value - positions[index]!);
    const first = steps[0]!;

    for (const step of steps) {
      // Within a microsecond of each other, across the whole run.
      expect(Math.abs(step - first)).toBeLessThan(1000);
    }
  });

  it("is stable when asked twice for the same instant", () => {
    // Two reads in one frame — the playhead and the follow-scroll — must agree,
    // or they disagree about where the head is by however long the frame took.
    const { playback, started } = playing();

    expect(playback.position(started + 500)).toBe(playback.position(started + 500));
  });

  it("does not run past the end of the edit", () => {
    const { playback, started } = playing();

    expect(playback.position(started + 60_000)).toBe(10 * S);
    expect(playback.hasEnded(started + 60_000)).toBe(true);
  });

  it("stands still while paused", () => {
    const { playback, started } = playing();

    playback.seek(3 * S);
    playback.pause();

    // Frozen wherever it stopped, whatever timestamp it is asked with — not
    // pinned to exactly 3s, since the microseconds between the seek and the
    // pause are real elapsed playback and belong in the position.
    const paused = playback.position();

    expect(paused).toBeGreaterThanOrEqual(3 * S);
    expect(paused).toBeLessThan(3 * S + 100 * MS);
    expect(playback.position(started + 5000)).toBe(paused);
    expect(playback.position(started + 50_000)).toBe(paused);
  });

  it("restarts from the top when played from the end", () => {
    // Otherwise pressing play at the end does nothing at all.
    const { playback } = playing(10 * S);

    playback.pause();
    playback.play();

    expect(playback.position()).toBeLessThan(S);
  });
});

describe("seeking", () => {
  it("clamps into the edit", () => {
    const playback = new Playback();
    playback.setDuration(10 * S);

    playback.seek(-5 * S);
    expect(playback.position()).toBe(0);

    playback.seek(99 * S);
    expect(playback.position()).toBe(10 * S);
  });

  it("keeps the playhead where it was when the duration changes", () => {
    // Re-anchored on the way through: clamping against a new duration without
    // that would make the head jump the moment a clip was trimmed.
    const playback = new Playback();
    playback.setDuration(10 * S);
    playback.seek(4 * S);

    playback.setDuration(8 * S);

    expect(playback.position()).toBe(4 * S);
  });

  it("pulls the playhead back when the edit gets shorter than it", () => {
    const playback = new Playback();
    playback.setDuration(10 * S);
    playback.seek(9 * S);

    playback.setDuration(5 * S);

    expect(playback.position()).toBe(5 * S);
  });
});

describe("play and pause", () => {
  it("holds the position across a pause", () => {
    // Read before the flag is cleared; the other order resolves against a stale
    // anchor and snaps the head back to where playing began.
    const playback = new Playback();
    playback.setDuration(10 * S);
    playback.seek(2 * S);
    playback.play();

    playback.pause();
    const paused = playback.position();

    expect(paused).toBeGreaterThanOrEqual(2 * S);
    expect(paused).toBeLessThan(2 * S + 500 * MS);
    expect(playback.position()).toBe(paused);
  });

  it("tells subscribers only when it changes state", () => {
    const playback = new Playback();
    playback.setDuration(10 * S);

    const seen: boolean[] = [];
    playback.subscribe((value) => seen.push(value));

    playback.play();
    playback.play();
    playback.pause();
    playback.pause();

    expect(seen).toEqual([true, false]);
  });
});
