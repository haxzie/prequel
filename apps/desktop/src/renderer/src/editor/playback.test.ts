/**
 * The clock the playhead is drawn from.
 *
 * The jitter this covers was not a drawing problem. The loop sampled
 * `performance.now()` inside its callback — when the callback happened to run —
 * while painting on the display's even cadence. Even motion demands an even
 * clock, and `requestAnimationFrame` already hands one to its callback.
 */
import { describe, expect, it } from "vitest";

import { Playback, syncElement } from "./playback";

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

/**
 * Nanosecond reads of a running clock drift by the sub-millisecond the calls
 * themselves take, so a preview's edges are asserted to within a frame rather
 * than exactly. The edges are the behaviour; the jitter is the measurement.
 */
function near(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(16 * MS);
}

describe("previewing one span", () => {
  it("starts at the span's start and stops at its end", () => {
    const playback = new Playback();
    playback.setDuration(10 * S);

    playback.playRange(3 * S, 5 * S);
    const started = performance.now();

    expect(playback.isPlaying).toBe(true);
    near(playback.position(started), 3 * S);

    // Halfway through the span, and still running.
    expect(playback.hasEnded(started + 1000)).toBe(false);

    // Past its end. The loop pauses on this, which is what makes it play once.
    expect(playback.hasEnded(started + 2500)).toBe(true);
  });

  it("holds the playhead at the span's end rather than running on", () => {
    const playback = new Playback();
    playback.setDuration(10 * S);

    playback.playRange(3 * S, 5 * S);

    // Without the limit this would read 8s — the preview would keep playing
    // through everything after the zoom it was meant to show.
    expect(playback.position(performance.now() + 5000)).toBe(5 * S);
  });

  it("is cancelled by a deliberate play, including one already running", () => {
    const playback = new Playback();
    playback.setDuration(10 * S);

    playback.playRange(3 * S, 5 * S);
    // Pressing play during a preview means "play the edit", so the span's end
    // must stop binding — otherwise playback halts at 5s for no visible reason.
    playback.play();

    expect(playback.hasEnded(performance.now() + 2500)).toBe(false);
  });

  it("is cancelled by moving the playhead", () => {
    const playback = new Playback();
    playback.setDuration(10 * S);

    playback.playRange(3 * S, 5 * S);
    playback.seek(8 * S);
    playback.pause();

    // The playhead has left the span, so the span's end is no longer the end.
    near(playback.position(), 8 * S);
    expect(playback.hasEnded()).toBe(false);
  });

  it("restarts rather than stacking when a second control is touched", () => {
    const playback = new Playback();
    playback.setDuration(10 * S);

    playback.playRange(3 * S, 5 * S);
    playback.playRange(6 * S, 7 * S);
    const started = performance.now();

    near(playback.position(started), 6 * S);
    expect(playback.hasEnded(started + 1500)).toBe(true);
  });

  it("still stops at the end of the edit when the span runs past it", () => {
    const playback = new Playback();
    playback.setDuration(4 * S);

    playback.playRange(2 * S, 99 * S);

    expect(playback.position(performance.now() + 9000)).toBe(4 * S);
  });
});

describe("correcting a paused element", () => {
  /** Enough of a media element for `syncElement`, recording what it was told. */
  function element(at: number, paused = true) {
    // Built then returned, rather than a literal with a `this`-using method: in
    // an object literal `this` widens to `{}` and the assignment does not
    // typecheck.
    const fake = {
      currentTime: at,
      paused,
      playbackRate: 1,
      play: () => Promise.resolve(),
      pause: () => {
        fake.paused = true;
      },
    };

    return fake as unknown as HTMLMediaElement & { currentTime: number; paused: boolean };
  }

  it("seeks a small drift out rather than nudging a rate that cannot run", () => {
    // 100ms is under the hard-seek threshold, so this used to take the nudge
    // branch — which sets `playbackRate` on an element that is not playing and
    // therefore never converges. The preview sat on a frame 100ms away.
    const paused = element(5.1);
    syncElement(paused, 5 * 1_000_000_000, false);

    expect(paused.currentTime).toBe(5);
  });

  it("still nudges while playing, where the rate has something to act on", () => {
    const playing = element(5.1, false);
    syncElement(playing, 5 * 1_000_000_000, true);

    // Left where it was and eased back through the rate: seeking every frame of
    // playback would flush the decoder every frame.
    expect(playing.currentTime).toBe(5.1);
    expect(playing.playbackRate).toBeLessThan(1);
  });

  it("leaves a paused element alone when it is already there", () => {
    // Well inside the in-sync window. Seeking here would flush the decoder for
    // a difference no one can see, on every frame the pointer does not move.
    const settled = element(5.001);
    syncElement(settled, 5 * 1_000_000_000, false);

    expect(settled.currentTime).toBe(5.001);
  });

  it("pauses a track that has no frame for this moment", () => {
    const camera = element(2, false);
    syncElement(camera, null, true);

    expect(camera.paused).toBe(true);
  });
});
