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
