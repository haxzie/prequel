/**
 * Placing the sound plan on the edit's clock.
 *
 * The plan arrives from main as cues on the *source* timeline. The preview
 * plays the edit — cuts and all — so each cue has to be found a place in
 * project time, or none if its moment was cut, and then a place on the audio
 * clock a little ahead of the playhead. The arithmetic is the same `place`
 * the media elements are positioned by, so a press and the frame it belongs
 * to cannot come apart at a cut.
 *
 * Pure, so the arming logic can be tested without a context, a clock or a
 * recording: the scheduler is told the time and hands cues to a sink.
 */
import type { SoundCues } from "../../../shared/contract";
import type { MediaTime } from "../../../shared/manifest";
import type { PlacedSlice } from "./timeline";

/** One cue, unpacked from the addon's parallel arrays. */
export interface SoundCue {
  /** Source time, nanoseconds. */
  at: MediaTime;
  /** The `CueKind` index: five key classes, then `CLICK_KIND`. */
  kind: number;
  variant: number;
  gain: number;
  pan: number;
}

/** The `CueKind` index of a mouse click. Everything below it is a key. */
export const CLICK_KIND = 5;

/** A cue with its place in the edit worked out. */
export interface PlacedCue {
  cue: SoundCue;
  /** Which clip it falls in, whose settings say which keyboard it is. */
  sliceId: string;
  projectAt: MediaTime;
  /** Where the clip ends, if that is inside the voice's reach; else null. */
  stopAt: MediaTime | null;
}

/**
 * How far past its end a clip can still be cutting a voice short, in
 * nanoseconds. The longest voice the bank renders; a cut further off than
 * this from a press cannot touch its sound.
 */
const VOICE_REACH: MediaTime = 300_000_000;

/**
 * How late a cue may be armed and still played, in nanoseconds.
 *
 * A frame that ran long, or a press a few milliseconds behind the moment a
 * seek landed on. Sixty milliseconds: past that a sound arriving late reads
 * as a sound in the wrong place, and silence is the lesser wrong.
 */
const LATE_TOLERANCE: MediaTime = 60_000_000;

/** Unpacks the addon's arrays into cues, in time order. */
export function decodeCues(cues: SoundCues): SoundCue[] {
  const count = Math.min(
    cues.at.length,
    cues.kind.length,
    cues.variant.length,
    cues.gain.length,
    cues.pan.length,
  );
  const out: SoundCue[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      at: cues.at[i] ?? 0,
      kind: cues.kind[i] ?? 0,
      variant: cues.variant[i] ?? 0,
      gain: cues.gain[i] ?? 0,
      pan: cues.pan[i] ?? 0,
    });
  }
  // The addon sorts, but the arming below binary-searches, and a plan that
  // arrived unsorted would silently miss cues rather than fail.
  return out.sort((a, b) => a.at - b.at);
}

/** First index whose `at` is not below `time`. `cues` must be sorted. */
function lowerBound(cues: readonly SoundCue[], time: MediaTime): number {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((cues[mid]?.at ?? Infinity) < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The cues whose moment falls in a window of *project* time, `from` included
 * and `to` not.
 *
 * Walks the clips the window overlaps and searches each clip's stretch of the
 * source. A cue in the gap between two clips is in no clip's stretch and is
 * never returned — a cut is a cut — and a cue near the end of a clip carries
 * the clip's end as its `stopAt`, so its voice is cut where the picture is.
 */
export function cuesBetween(
  placed: readonly PlacedSlice[],
  cues: readonly SoundCue[],
  from: MediaTime,
  to: MediaTime,
): PlacedCue[] {
  const out: PlacedCue[] = [];
  if (to <= from || cues.length === 0) return out;

  for (const slice of placed) {
    const sliceEnd = slice.timelineStart + slice.duration;
    if (sliceEnd <= from || slice.timelineStart >= to) continue;

    // The window's overlap with this clip, in source time.
    const sourceFrom =
      slice.source.start + (Math.max(from, slice.timelineStart) - slice.timelineStart);
    const sourceTo = slice.source.start + (Math.min(to, sliceEnd) - slice.timelineStart);

    for (let i = lowerBound(cues, sourceFrom); i < cues.length; i++) {
      const cue = cues[i];
      if (!cue || cue.at >= sourceTo) break;
      const projectAt = slice.timelineStart + (cue.at - slice.source.start);
      out.push({
        cue,
        sliceId: slice.id,
        projectAt,
        stopAt: sliceEnd - projectAt < VOICE_REACH ? sliceEnd : null,
      });
    }
  }

  return out;
}

/** Where a scheduler puts the cues it arms. */
export interface CueSink {
  /** `when` and `stopAt` are on the audio clock, in seconds. */
  schedule(placed: PlacedCue, when: number, stopAt: number | null): void;
  /** Stop everything armed so far. */
  cancel(): void;
}

export interface SchedulerTick {
  /** The playhead, in project time. */
  projectNow: MediaTime;
  /** The audio clock at the same instant, in seconds. */
  contextNow: number;
  playing: boolean;
  /** Whether the playhead landed somewhere other than where it was heading. */
  jumped: boolean;
  placed: readonly PlacedSlice[];
  cues: readonly SoundCue[];
  /** How far ahead of the playhead to arm, in nanoseconds. */
  lookaheadNs: MediaTime;
  sink: CueSink;
}

/**
 * Arms cues a little ahead of the playhead, each exactly once.
 *
 * Driven from the playback loop's tick. WebAudio wants to be told about a
 * sound before its moment — a source started at a time already past plays
 * late — so each tick arms the stretch from where the last tick left off to a
 * lookahead past now. A pause or a seek throws the armed sounds away and
 * starts the stretch again from the new position; nothing arms while paused.
 *
 * The audio clock and the frame clock are sampled together on every tick and
 * the mapping is re-anchored each time, so any drift between them is bounded
 * by what accrues inside one lookahead window — well under a frame.
 */
export class CueScheduler {
  /** Project time armed up to, or null when nothing is armed. */
  private armedUpTo: MediaTime | null = null;

  tick({
    projectNow,
    contextNow,
    playing,
    jumped,
    placed,
    cues,
    lookaheadNs,
    sink,
  }: SchedulerTick): void {
    if (!playing || jumped) {
      if (this.armedUpTo !== null) {
        sink.cancel();
        this.armedUpTo = null;
      }
      if (!playing) return;
    }

    const from = this.armedUpTo ?? projectNow;
    const to = projectNow + lookaheadNs;
    if (to <= from) return;

    for (const placedCue of cuesBetween(placed, cues, from, to)) {
      const late = projectNow - placedCue.projectAt;
      if (late > LATE_TOLERANCE) continue;

      const when = contextNow + (placedCue.projectAt - projectNow) / 1e9;
      const stopAt =
        placedCue.stopAt === null ? null : contextNow + (placedCue.stopAt - projectNow) / 1e9;
      sink.schedule(placedCue, when, stopAt);
    }

    this.armedUpTo = to;
  }

  /** Forgets what was armed, without cancelling it. For a sink that already did. */
  reset(): void {
    this.armedUpTo = null;
  }
}
