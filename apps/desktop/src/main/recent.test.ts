/**
 * What the tray's Open Recent menu is allowed to offer.
 *
 * An interrupted take leaves a directory with a half-written screen track and
 * nothing describing it. Listing that would produce a menu item that only ever
 * fails on click, so the manifest is the thing that decides.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { MANIFEST_FILE_NAME } from "../shared/manifest.js";

vi.mock("electron", () => ({
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
  app: { getPath: () => tmpdir() },
}));

const { fileTimestamp, recentRecordings } = await import("./session.js");
const { exportFileName } = await import("./export.js");

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-recent-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A recording directory, with its manifest stamped at `secondsAgo`. */
function recording(name: string, secondsAgo: number): string {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, MANIFEST_FILE_NAME);
  writeFileSync(manifest, "{}");

  const at = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(manifest, at, at);
  return dir;
}

describe("recentRecordings", () => {
  it("lists recordings newest first", () => {
    const older = recording("older", 60);
    const newer = recording("newer", 10);

    expect(recentRecordings(10, SCRATCH).map((r) => r.dir)).toEqual([newer, older]);
  });

  it("skips a directory with no manifest", () => {
    // An interrupted take. There is nothing to open.
    mkdirSync(join(SCRATCH, "interrupted"), { recursive: true });

    expect(recentRecordings(10, SCRATCH).map((r) => r.name)).not.toContain("interrupted");
  });

  it("honours the limit", () => {
    recording("a", 1);
    recording("b", 2);
    recording("c", 3);

    expect(recentRecordings(2, SCRATCH)).toHaveLength(2);
  });

  it("returns nothing when the recordings folder does not exist yet", () => {
    // Before the first recording. The menu is empty rather than broken.
    expect(recentRecordings(10, join(SCRATCH, "never-created"))).toEqual([]);
  });
});

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
