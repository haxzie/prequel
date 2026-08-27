/** Nanoseconds per second, the unit every media time in the manifest is in. */
export const NS_PER_SECOND = 1_000_000_000;

/**
 * `m:ss.cc` — the timecode an editor needs.
 *
 * Hundredths rather than whole seconds: a cut is placed to a frame, and a
 * readout that only ticks once a second cannot tell you where the playhead is.
 */
export function formatTimecode(ns: number): string {
  const total = Math.max(0, ns) / NS_PER_SECOND;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const hundredths = Math.floor((total * 100) % 100);

  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

/** `m:ss`, or `h:mm:ss` once it runs past an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * How long ago something happened, for a list of them.
 *
 * Coarse on purpose, and coarser the further back it goes: the question a
 * library answers is "which of these is the one I made this morning", not how
 * many minutes ago that was. Past a week the date is more use than the
 * interval — nobody counts in "23 days ago" — and past a year it needs the year
 * to be unambiguous at all.
 */
export function formatTimeAgo(epochMs: number, now = Date.now()): string {
  const seconds = Math.round((now - epochMs) / 1000);

  // Also covers a clock that went backwards and a file stamped in the future.
  // "In 3 minutes" beside a recording is stranger than rounding to the present.
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${plural(minutes, "minute")} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  const then = new Date(epochMs);
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
