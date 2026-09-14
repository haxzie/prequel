/**
 * The arithmetic under the player, kept apart from the DOM so it reads on
 * its own.
 *
 * Seconds throughout, because that is what `<video>` speaks. The API's
 * chapters arrive in milliseconds — the row's unit — and are converted once,
 * at the edge, in `Watch.tsx`.
 */

/** One entry in the table of contents, in seconds. */
export interface Chapter {
  at: number;
  title: string;
}

/**
 * A time as a clock shows it.
 *
 * `total` decides the shape rather than the value: in a recording that runs
 * past an hour, `0:05` and `1:00:05` have to line up under each other, so every
 * time in it is written with hours. Below an hour the hour is left off — a
 * two-minute clip stamped `0:00:12` reads as a broadcast timecode.
 */
export function formatTime(seconds: number, total = seconds): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(rest).padStart(2, "0");

  return total >= 3600 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/**
 * Which chapter a moment falls in, or -1 before the first.
 *
 * The chapters are sorted and the first starts at zero — the API promises both
 * — so this is the last one that has begun. Linear rather than binary because
 * there are at most twelve.
 */
export function chapterAt(chapters: readonly Chapter[], seconds: number): number {
  let index = -1;
  for (let i = 0; i < chapters.length; i += 1) {
    if (chapters[i]!.at <= seconds) index = i;
    else break;
  }
  return index;
}

/**
 * The chapters as spans of the bar, each a fraction of the whole.
 *
 * The last runs to the end. A recording with no chapters is one span, so the
 * bar is drawn the same way either way and "no chapters" is not a second
 * rendering path.
 */
export function segments(
  chapters: readonly Chapter[],
  duration: number,
): { start: number; end: number; title: string | null }[] {
  if (chapters.length === 0 || duration <= 0) return [{ start: 0, end: 1, title: null }];

  return chapters.map((chapter, index) => ({
    start: Math.min(chapter.at / duration, 1),
    end: index + 1 < chapters.length ? Math.min(chapters[index + 1]!.at / duration, 1) : 1,
    title: chapter.title,
  }));
}

/** Where to go for a fraction of the bar, kept inside the recording. */
export function clampTime(seconds: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, seconds);
  return Math.min(Math.max(0, seconds), duration);
}

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** The next speed up or down from `rate`, staying on the list. */
export function stepRate(rate: number, direction: 1 | -1): number {
  const index = RATES.findIndex((candidate) => candidate >= rate);
  const current = index === -1 ? RATES.length - 1 : index;
  const next = Math.min(Math.max(current + direction, 0), RATES.length - 1);
  return RATES[next]!;
}

/** `1.5×`, and `1×` rather than `1.00×`. */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}
