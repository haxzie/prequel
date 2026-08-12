/**
 * Where the ruler's ticks go.
 *
 * The interval has to change with the zoom or the ruler is unreadable at both
 * ends: a tick per second is a grey smear on a ten-minute take, and a tick per
 * minute is useless when you are placing a cut on a frame.
 *
 * Pure, so the ladder can be tested without a window.
 */
import type { MediaTime } from "../../../shared/manifest";

const NS_PER_SECOND = 1_000_000_000;

/**
 * Intervals the ruler is allowed to use, in seconds.
 *
 * A ladder rather than a computed step, because the readable intervals are the
 * ones people already count in — 5s, 15s, a minute. An arithmetically "ideal"
 * 3.7s tick is worse than a slightly too dense 2s one.
 */
const LADDER = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Room a label needs before the next one starts crowding it. */
const MIN_LABEL_PX = 68;

export interface Tick {
  at: MediaTime;
  /** Majors carry a label and a full-height line; minors are a stub. */
  major: boolean;
  label?: string;
}

/** The labelled interval, in seconds, for a zoom level. */
export function tickInterval(pxPerSecond: number, minLabelPx = MIN_LABEL_PX): number {
  if (!Number.isFinite(pxPerSecond) || pxPerSecond <= 0) return LADDER.at(-1)!;

  return LADDER.find((seconds) => seconds * pxPerSecond >= minLabelPx) ?? LADDER.at(-1)!;
}

/**
 * Every tick across a duration.
 *
 * Minors subdivide the major interval into fifths — enough to judge a position
 * between two labels without turning the ruler into a comb.
 */
export function ticks(duration: MediaTime, pxPerSecond: number): Tick[] {
  if (duration <= 0 || pxPerSecond <= 0) return [];

  const major = tickInterval(pxPerSecond);
  const minor = major / 5;
  const total = duration / NS_PER_SECOND;

  const out: Tick[] = [];
  // Counted in steps rather than accumulated, so floating-point drift cannot
  // push a tick off the label it belongs to on a long take.
  const steps = Math.floor(total / minor);

  for (let step = 0; step <= steps; step += 1) {
    const seconds = step * minor;
    // A major lands every fifth minor by construction; compared on the step
    // rather than the time so rounding cannot lose one.
    const isMajor = step % 5 === 0;

    out.push({
      at: Math.round(seconds * NS_PER_SECOND),
      major: isMajor,
      ...(isMajor ? { label: formatTick(seconds, major) } : {}),
    });
  }

  return out;
}

/**
 * A tick's label.
 *
 * Sub-second intervals need decimals; anything coarser reads better without
 * them. Minutes are always shown, so `0:05` never gets mistaken for five
 * minutes on a zoomed-out ruler.
 */
export function formatTick(seconds: number, interval: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;

  if (interval < 1) {
    return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
  }
  return `${minutes}:${String(Math.round(rest)).padStart(2, "0")}`;
}

/** Pixels per second that fits a duration into a width. */
export function fitZoom(duration: MediaTime, width: number): number {
  if (duration <= 0 || width <= 0) return 1;
  return width / (duration / NS_PER_SECOND);
}
