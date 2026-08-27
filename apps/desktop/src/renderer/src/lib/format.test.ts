/**
 * The readouts, at the boundaries where they change shape.
 *
 * Each is drawn beside something the user is trying to identify, so being off
 * by a bucket is not cosmetic — "Yesterday" against a take made an hour ago
 * sends someone to the wrong recording.
 */
import { describe, expect, it } from "vitest";

import { formatElapsed, formatTimeAgo, formatTimecode, NS_PER_SECOND } from "./format";

const NOW = new Date("2026-08-26T12:00:00.000Z").getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatTimeAgo", () => {
  it("rounds the last minute to the present", () => {
    expect(formatTimeAgo(NOW, NOW)).toBe("Just now");
    expect(formatTimeAgo(NOW - 59_000, NOW)).toBe("Just now");
  });

  it("does not count forwards", () => {
    // A file stamped in the future, or a clock that went back. "In 3 minutes"
    // beside a recording is stranger than rounding it to the present.
    expect(formatTimeAgo(NOW + 5 * MINUTE, NOW)).toBe("Just now");
  });

  it("counts minutes, then hours", () => {
    expect(formatTimeAgo(NOW - MINUTE, NOW)).toBe("1 minute ago");
    expect(formatTimeAgo(NOW - 59 * MINUTE, NOW)).toBe("59 minutes ago");
    expect(formatTimeAgo(NOW - HOUR, NOW)).toBe("1 hour ago");
    expect(formatTimeAgo(NOW - 23 * HOUR, NOW)).toBe("23 hours ago");
  });

  it("names yesterday rather than counting to it", () => {
    expect(formatTimeAgo(NOW - DAY, NOW)).toBe("Yesterday");
    expect(formatTimeAgo(NOW - 6 * DAY, NOW)).toBe("6 days ago");
  });

  it("gives a date once an interval stops being useful", () => {
    // Nobody counts in "23 days ago".
    expect(formatTimeAgo(NOW - 20 * DAY, NOW)).toMatch(/Aug/);
    expect(formatTimeAgo(NOW - 20 * DAY, NOW)).not.toMatch(/ago/);
  });

  it("carries the year once there is more than one in the list", () => {
    const lastYear = new Date("2025-03-04T12:00:00.000Z").getTime();

    expect(formatTimeAgo(lastYear, NOW)).toMatch(/2025/);
    expect(formatTimeAgo(NOW - 20 * DAY, NOW)).not.toMatch(/2026/);
  });
});

describe("formatTimecode", () => {
  it("ticks in hundredths, because a cut is placed to a frame", () => {
    expect(formatTimecode(0)).toBe("0:00.00");
    expect(formatTimecode(61.5 * NS_PER_SECOND)).toBe("1:01.50");
  });

  it("never runs negative", () => {
    expect(formatTimecode(-1)).toBe("0:00.00");
  });
});

describe("formatElapsed", () => {
  it("grows an hours field only once there is one", () => {
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });
});
