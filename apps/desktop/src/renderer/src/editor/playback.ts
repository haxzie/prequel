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
  /**
   * Where a one-off preview stops, or null when playing the whole edit.
   *
   * Held here rather than as a timer in the caller: the loop already asks this
   * class whether playback has run out, and a timer would be a second authority
   * on when to stop — one that keeps running when the clock is paused, and fires
   * against a playhead that has since been dragged somewhere else.
   */
  private limit: MediaTime | null = null;

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
    return Math.min(this.anchorProject + elapsed, this.stopsAt);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Where this run of playback ends: a preview's limit, or the whole edit. */
  private get stopsAt(): MediaTime {
    return this.limit === null ? this.duration : Math.min(this.limit, this.duration);
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
    // A deliberate play is the whole edit, so it cancels a preview's limit —
    // cleared before the early return, or asking to play while a preview is
    // still running would leave it stopping short at the preview's end.
    this.limit = null;
    if (this.playing) return;
    // Restart from the top rather than sitting stuck at the end.
    if (this.anchorProject >= this.duration) this.anchorProject = 0;

    this.anchorWall = performance.now();
    this.playing = true;
    this.emit();
  }

  /**
   * Plays one span once, from its start, and stops at its end.
   *
   * For previewing what a control just changed. Re-anchored rather than queued
   * when one is already running, so touching a second control restarts the
   * preview instead of leaving two of them fighting over the playhead.
   */
  playRange(from: MediaTime, to: MediaTime): void {
    this.anchorProject = Math.min(Math.max(0, from), this.duration);
    this.limit = Math.min(Math.max(this.anchorProject, to), this.duration);
    this.anchorWall = performance.now();

    if (this.playing) return;
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
    // Moving the playhead ends a preview: it was showing one span, and the
    // playhead is no longer in it.
    this.limit = null;
    this.anchorProject = Math.min(Math.max(0, time), this.duration);
    this.anchorWall = performance.now();
  }

  /** Fires only on play/pause. The position is polled, never pushed. */
  subscribe(listener: (playing: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True once the playhead has run past the end of this run of playback. */
  hasEnded(now?: number): boolean {
    return this.stopsAt > 0 && this.position(now) >= this.stopsAt;
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
  //
  // The last clause is what makes a paused preview follow the playhead at all.
  // Nudging works by letting a running element catch up, and a paused one is not
  // running — so a drift the nudge branch claims to handle instead sits there
  // untouched, and the preview shows a frame up to a quarter-second from where
  // the playhead is. Paused, any drift worth noticing has to be a real seek.
  if (options.seek || magnitude > HARD_SEEK_NS || (!playing && magnitude > IN_SYNC_NS)) {
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
