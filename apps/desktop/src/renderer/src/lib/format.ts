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
