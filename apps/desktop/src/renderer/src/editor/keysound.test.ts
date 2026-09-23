/**
 * The arming logic, driven by hand.
 *
 * What matters: a cue is armed once and only once across ticks, at the right
 * place on the audio clock; a cut is respected; a pause or a seek throws the
 * armed sounds away; nothing arms while paused.
 */
import { describe, expect, it } from "vitest";

import {
  CLICK_KIND,
  CueScheduler,
  cuesBetween,
  decodeCues,
  type PlacedCue,
  type SoundCue,
} from "./keysound";
import { place } from "./timeline";

const S = 1_000_000_000;

function cue(at: number, kind = 0): SoundCue {
  return { at, kind, variant: 0, gain: 1, pan: 0 };
}

/** Two clips: source 0–1 s and 2–3 s, laid end to end. */
const cutEdit = place([
  { id: "a", source: { start: 0, end: S }, speed: 1 },
  { id: "b", source: { start: 2 * S, end: 3 * S }, speed: 1 },
]);

class Recorder {
  scheduled: { placed: PlacedCue; when: number; stopAt: number | null }[] = [];
  cancels = 0;
  schedule(placed: PlacedCue, when: number, stopAt: number | null) {
    this.scheduled.push({ placed, when, stopAt });
  }
  cancel() {
    this.cancels++;
    this.scheduled = [];
  }
}

describe("decodeCues", () => {
  it("unpacks the addon's arrays and sorts by time", () => {
    const cues = decodeCues({
      at: Float64Array.from([2e9, 1e9]),
      kind: Uint8Array.from([CLICK_KIND, 0]),
      variant: Uint8Array.from([3, 4]),
      gain: Float32Array.from([1, 0.5]),
      pan: Float32Array.from([0, -0.1]),
    });
    expect(cues.map((c) => c.at)).toEqual([1e9, 2e9]);
    expect(cues[0]!.variant).toBe(4);
    expect(cues[1]!.kind).toBe(CLICK_KIND);
  });
});

describe("cuesBetween", () => {
  it("finds a cue by its place in the edit, not in the source", () => {
    // Source 2.5 s is project 1.5 s: the second clip, half a second in.
    const found = cuesBetween(cutEdit, [cue(2.5 * S)], 1.4 * S, 1.6 * S);
    expect(found).toHaveLength(1);
    expect(found[0]!.projectAt).toBe(1.5 * S);
    expect(found[0]!.sliceId).toBe("b");
    expect(found[0]!.stopAt).toBeNull();
  });

  it("never returns a cue whose moment was cut out", () => {
    // Source 1.5 s is in the gap between the clips.
    expect(cuesBetween(cutEdit, [cue(1.5 * S)], 0, 2 * S)).toEqual([]);
  });

  it("carries the cut as a stop for a cue near the end of a clip", () => {
    // 50 ms before the first clip ends: the voice would run past the join.
    const found = cuesBetween(cutEdit, [cue(S - 50_000_000)], 0, 2 * S);
    expect(found).toHaveLength(1);
    expect(found[0]!.stopAt).toBe(S);
    // Half a second before it, no voice reaches the join.
    expect(cuesBetween(cutEdit, [cue(S / 2)], 0, 2 * S)[0]!.stopAt).toBeNull();
  });

  it("is half-open, so adjacent windows share no cue", () => {
    const cues = [cue(0.2 * S), cue(0.4 * S), cue(0.6 * S)];
    const first = cuesBetween(cutEdit, cues, 0, 0.4 * S);
    const second = cuesBetween(cutEdit, cues, 0.4 * S, 0.8 * S);
    expect(first.map((c) => c.cue.at)).toEqual([0.2 * S]);
    expect(second.map((c) => c.cue.at)).toEqual([0.4 * S, 0.6 * S]);
  });
});

describe("CueScheduler", () => {
  const cues = [cue(0.3 * S), cue(0.5 * S), cue(2.2 * S)];
  const lookaheadNs = 0.4 * S;

  it("arms each cue exactly once across successive ticks", () => {
    const scheduler = new CueScheduler();
    const sink = new Recorder();
    // Ticks every 16 ms from 0 to 0.8 s, audio clock running alongside.
    for (let ms = 0; ms <= 800; ms += 16) {
      scheduler.tick({
        projectNow: ms * 1e6,
        contextNow: 10 + ms / 1000,
        playing: true,
        jumped: false,
        placed: cutEdit,
        cues,
        lookaheadNs,
        sink,
      });
    }
    expect(sink.scheduled.map((s) => s.placed.cue.at)).toEqual([0.3 * S, 0.5 * S]);
    // On the audio clock: the cue at project 0.3 s is at context 10.3 s,
    // whichever tick armed it.
    expect(sink.scheduled[0]!.when).toBeCloseTo(10.3, 6);
    expect(sink.scheduled[1]!.when).toBeCloseTo(10.5, 6);
    expect(sink.cancels).toBe(0);
  });

  it("arms nothing while paused, and everything again after a seek", () => {
    const scheduler = new CueScheduler();
    const sink = new Recorder();
    const tick = (ms: number, playing: boolean, jumped = false) =>
      scheduler.tick({
        projectNow: ms * 1e6,
        contextNow: ms / 1000,
        playing,
        jumped,
        placed: cutEdit,
        cues,
        lookaheadNs,
        sink,
      });

    tick(0, false);
    expect(sink.scheduled).toEqual([]);

    tick(0, true);
    expect(sink.scheduled.map((s) => s.placed.cue.at)).toEqual([0.3 * S]);

    // Pause: the armed cue is thrown away.
    tick(100, false);
    expect(sink.cancels).toBe(1);
    expect(sink.scheduled).toEqual([]);

    // Resume from a seek to 0.2 s: 0.3 s and 0.5 s are ahead again.
    tick(200, true, true);
    expect(sink.scheduled.map((s) => s.placed.cue.at)).toEqual([0.3 * S, 0.5 * S]);

    // A seek while playing cancels and re-arms from the new place: project
    // 1.1 s is the second clip, and source 2.2 s is a tenth ahead of it.
    tick(1_100, true, true);
    expect(sink.cancels).toBe(2);
    expect(sink.scheduled.map((s) => s.placed.cue.at)).toEqual([2.2 * S]);
  });

  it("plays a cue a few milliseconds late, and drops one long past", () => {
    const scheduler = new CueScheduler();
    const sink = new Recorder();
    // Resuming at 0.32 s: the cue at 0.3 s is 20 ms behind, close enough.
    scheduler.tick({
      projectNow: 0.32 * S,
      contextNow: 5,
      playing: true,
      jumped: true,
      placed: cutEdit,
      cues,
      lookaheadNs,
      sink,
    });
    // Nothing behind the playhead is in the window at all when starting
    // fresh — the window begins at now.
    expect(sink.scheduled.map((s) => s.placed.cue.at)).toEqual([0.5 * S]);

    // But a tick that ran long leaves a gap the next tick has to cover.
    const slow = new CueScheduler();
    const late = new Recorder();
    const tick = (ms: number) =>
      slow.tick({
        projectNow: ms * 1e6,
        contextNow: ms / 1000,
        playing: true,
        jumped: false,
        placed: cutEdit,
        cues,
        lookaheadNs: 0.05 * S,
        sink: late,
      });
    tick(200);
    // 120 ms later: the cue at 0.3 s is 20 ms in the past. Played, now.
    tick(320);
    expect(late.scheduled.map((s) => s.placed.cue.at)).toEqual([0.3 * S]);
    expect(late.scheduled[0]!.when).toBeCloseTo(0.3, 6);
  });

  it("stops a voice at the cut, on the audio clock", () => {
    const scheduler = new CueScheduler();
    const sink = new Recorder();
    scheduler.tick({
      projectNow: 0.9 * S,
      contextNow: 1,
      playing: true,
      jumped: false,
      placed: cutEdit,
      cues: [cue(0.95 * S)],
      lookaheadNs,
      sink,
    });
    expect(sink.scheduled).toHaveLength(1);
    expect(sink.scheduled[0]!.when).toBeCloseTo(1.05, 6);
    expect(sink.scheduled[0]!.stopAt).toBeCloseTo(1.1, 6);
  });
});
