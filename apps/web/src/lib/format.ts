/**
 * Bytes, in the units a storage figure is read in.
 *
 * Base 1000 rather than 1024, to agree with what R2 bills and what macOS shows
 * for the same file. A library that reports less than the invoice is the sort of
 * discrepancy nobody can explain a year later.
 *
 * In `lib/` rather than beside the library page it was written for: the billing
 * panel needs it too and that one is a client component, and importing anything
 * from a page module pulls `next/headers` into the browser bundle — a build
 * error naming a file nobody touched.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * The value `apps/api/src/lib/entitlement.ts` stores to mean "no limit".
 *
 * Repeated rather than imported: `apps/web` shares no code with `apps/api`
 * beyond request and response types, so the two agree by being written the same
 * on both sides. It is `Number.MAX_SAFE_INTEGER`, which survives JSON exactly.
 */
const UNLIMITED_QUOTA_BYTES = Number.MAX_SAFE_INTEGER;

/**
 * A quota, as a person would say it.
 *
 * `formatBytes` on the unlimited sentinel prints "9007 TB", which is not a
 * number anybody was sold and reads as a bug next to the word the pricing page
 * uses. Every surface that shows an allowance goes through this.
 */
export function formatQuota(bytes: number): string {
  return bytes >= UNLIMITED_QUOTA_BYTES ? "Unlimited" : formatBytes(bytes);
}

/** Milliseconds in a day, which is what makes the two day indices below. */
const DAY_MS = 86_400_000;

/**
 * A date as an age — "Today", "Yesterday", "4 days ago".
 *
 * Counted in whole days apart rather than in elapsed hours: a release dated
 * yesterday evening is "Yesterday" and not "16 hours ago", which is the way
 * anybody reads a release date. Both sides are floored to a UTC day index for
 * that, because the `.mdx` dates carry no time and no zone — treating them as
 * local midnight would make the same release a day older west of Greenwich.
 *
 * Falls back to months past the first four weeks. "47 days ago" is arithmetic
 * rather than news, and a badge saying it has stopped being a recency signal.
 */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const then = Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / DAY_MS);
  const days = Math.max(0, Math.floor(now.getTime() / DAY_MS) - then);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 28) return `${days} days ago`;

  const months = Math.max(1, Math.round(days / 30.44));
  return months === 1 ? "Last month" : `${months} months ago`;
}
