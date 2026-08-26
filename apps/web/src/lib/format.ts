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
