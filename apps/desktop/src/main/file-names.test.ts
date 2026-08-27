/**
 * The names recordings and exports are written under.
 *
 * Both stamps come from `fileTimestamp`, so a Finder window sorted by name runs
 * in the order the takes were made — which is the whole reason the year leads.
 */
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
  app: { getPath: () => tmpdir() },
}));

const { fileTimestamp } = await import("./session.js");
const { exportFileName } = await import("./export.js");

describe("file names", () => {
  it("stamps a timestamp Finder and the shell both tolerate", () => {
    // Colons are legal on APFS but confuse shells and Finder's quick actions.
    const stamp = fileTimestamp(new Date("2026-08-11T12:30:00.000Z"));

    expect(stamp).toBe("2026-08-11 12-30-00");
    expect(stamp).not.toContain(":");
    expect(stamp).not.toContain(".");
  });

  it("gives every export its own name", () => {
    // A fixed `export.mp4` either destroyed the previous attempt or collided
    // with it — `AVAssetWriter` refuses to write over an existing file, so a
    // second export failed outright.
    const first = exportFileName("h264", new Date("2026-08-11T12:30:00.000Z"));
    const second = exportFileName("h264", new Date("2026-08-11T12:31:00.000Z"));

    expect(first).toBe("Export 2026-08-11 12-30-00.mp4");
    expect(first).not.toBe(second);
  });

  it("names a GIF export .gif", () => {
    // The extension follows the format in one place. A GIF written into a file
    // called `.mp4` opens in nothing on the system, and the failure is a
    // Finder error rather than anything the app reports.
    const at = new Date("2026-08-11T12:30:00.000Z");

    expect(exportFileName("gif", at)).toBe("Export 2026-08-11 12-30-00.gif");
    expect(exportFileName("hevc", at)).toBe("Export 2026-08-11 12-30-00.mp4");
  });

  it("sorts exports oldest to newest by name", () => {
    // The reason the stamp leads with the year: Finder sorts by name, and a
    // list that does not run in order is worse than no order at all.
    const names = [
      exportFileName("h264", new Date("2026-08-11T12:31:00.000Z")),
      exportFileName("h264", new Date("2026-08-11T12:30:00.000Z")),
      exportFileName("h264", new Date("2026-01-02T03:04:05.000Z")),
    ];

    expect([...names].sort()).toEqual([names[2], names[1], names[0]]);
  });
});
