/**
 * The master clock, and the correction that keeps the media following it.
 *
 * Four files have to play as one thing. Letting any of them be the clock does
 * not work — they have different frame rates, they start at different moments,
 * and a cut makes each of them jump somewhere else — so time is kept here and
 * the elements are corrected towards it.
 *
 * Not React state. The position changes sixty times a second, and rendering the
 * whole editor on every tick would spend the frame budget on reconciliation
 * rather than on drawing.
 */
import type { MediaTime } from "../../../shared/manifest";

const NS_PER_MS = 1_000_000;

/**
 * Drift a seek is used for.
 *
 * Below this, a seek costs more than the error it fixes: `currentTime =` forces
 * a decoder flush, and doing that every frame stutters visibly. Above it,
 * nudging would take too long to converge to be worth watching.
 */
const HARD_SEEK_NS = 250 * NS_PER_MS;

/** Drift small enough to ignore entirely — well under one frame at 60fps. */
const IN_SYNC_NS = 30 * NS_PER_MS;

/** How hard the rate is nudged while a track catches up. */
const NUDGE_RATE = 0.04;

export class Playback {
  private playing = false;
  /** Project time at the moment the clock was last anchored. */
  private anchorProject: MediaTime = 0;
  /** `performance.now()` at that same moment. */
  private anchorWall = 0;
  private duration: MediaTime = 0;

  private readonly listeners = new Set<(playing: boolean) => void>();

  /**
   * Where the playhead is, in project nanoseconds.
   *
   * `now` should be the timestamp `requestAnimationFrame` hands its callback,
   * not `performance.now()`. The rAF timestamp is when the frame will be
   * *displayed*, and every frame's is evenly spaced; `performance.now()` inside
   * the callback is when the callback happened to run, which drifts with
   * whatever else the frame had to do first. Sampling on an uneven clock while
   * painting on an even one is what makes a playhead judder — the motion is
   * wrong, not the drawing.
   *
   * The two share a time origin, so the default is still correct for one-off
   * reads outside a frame.
   */
  position(now = performance.now()): MediaTime {
    if (!this.playing) return this.anchorProject;

    const elapsed = (now - this.anchorWall) * NS_PER_MS;
    return Math.min(this.anchorProject + elapsed, this.duration);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Sets the length of the edit.
   *
   * Re-anchored first: the playhead is derived from the anchor, and clamping a
   * position against a new duration without doing so would make it jump.
   */
  setDuration(duration: MediaTime): void {
    this.anchorProject = Math.min(this.position(), duration);
    this.anchorWall = performance.now();
    this.duration = duration;
  }

  play(): void {
    if (this.playing) return;
    // Restart from the top rather than sitting stuck at the end.
    if (this.anchorProject >= this.duration) this.anchorProject = 0;

    this.anchorWall = performance.now();
    this.playing = true;
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    // Read the position *before* clearing the flag, or it resolves against a
    // stale anchor and the playhead jumps back to where playing began.
    this.anchorProject = this.position();
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: MediaTime): void {
    this.anchorProject = Math.min(Math.max(0, time), this.duration);
    this.anchorWall = performance.now();
  }

  /** Fires only on play/pause. The position is polled, never pushed. */
  subscribe(listener: (playing: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True once the playhead has run past the end of the edit. */
  hasEnded(now?: number): boolean {
    return this.duration > 0 && this.position(now) >= this.duration;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.playing);
  }
}

/**
 * Brings one media element towards where the clock says it should be.
 *
 * Corrects rather than drives. Assigning `currentTime` every frame would seek
 * the decoder every frame, which is both slow and visibly juddery — so a small
 * error is left alone, a moderate one is nudged out through the playback rate,
 * and only a large one or a deliberate jump is worth a real seek.
 *
 * `expected` is null when the track has no frame for this moment — before the
 * camera opened, or after it stopped — and the element is simply paused.
 */
export function syncElement(
  element: HTMLMediaElement,
  expected: MediaTime | null,
  playing: boolean,
  options: { seek?: boolean } = {},
): void {
  if (expected === null) {
    if (!element.paused) element.pause();
    return;
  }

  const target = expected / 1_000_000_000;
  const drift = (element.currentTime - target) * 1000 * NS_PER_MS;
  const magnitude = Math.abs(drift);

  // A slice boundary was crossed, or the user scrubbed: the element is not
  // behind, it is somewhere else entirely.
  if (options.seek || magnitude > HARD_SEEK_NS) {
    element.currentTime = target;
    setRate(element, 1);
  } else if (magnitude > IN_SYNC_NS) {
    // Behind the clock speeds up, ahead of it slows down.
    setRate(element, drift < 0 ? 1 + NUDGE_RATE : 1 - NUDGE_RATE);
  } else {
    setRate(element, 1);
  }

  if (playing && element.paused) {
    // Rejected when the element has no data yet, which is normal right after a
    // seek — the next tick tries again.
    void element.play().catch(() => undefined);
  } else if (!playing && !element.paused) {
    element.pause();
  }
}

/**
 * Sets the playback rate, but only when it actually changes.
 *
 * Assigning to a media element is not free even when the value is identical —
 * it goes through the element's own machinery every time. Doing that to two
 * video elements on every frame is real work spent achieving nothing, and it
 * shows up as exactly the sort of lag that only appears once a second source is
 * added.
 */
function setRate(element: HTMLMediaElement, rate: number): void {
  if (element.playbackRate !== rate) element.playbackRate = rate;
}
