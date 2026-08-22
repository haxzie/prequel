/**
 * What discarding a take is allowed to delete.
 *
 * This is a recursive delete on a path that arrives from a button, with no
 * confirmation in front of it. The guard is the only thing between a bug in the
 * caller and somebody's home directory, so it is worth pinning properly: the
 * interesting cases are not "does it delete a recording" but the paths it must
 * refuse.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
  app: { getPath: () => tmpdir() },
}));

const { deleteRecording } = await import("./session.js");

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-discard-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const ROOT = join(SCRATCH, "Prequel");

/** A recording directory with a file in it, so the delete has to recurse. */
function take(name: string, dir = ROOT): string {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "screen.mp4"), "not really a video");
  return path;
}

describe("deleteRecording", () => {
  it("removes a take and everything in it", () => {
    const path = take("Prequel 2026-08-22 13-04-11");

    expect(deleteRecording(path, ROOT)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses the recordings folder itself", () => {
    mkdirSync(ROOT, { recursive: true });
    const keep = take("Prequel 2026-08-22 09-00-00");

    expect(deleteRecording(ROOT, ROOT)).toBe(false);
    expect(existsSync(ROOT)).toBe(true);
    expect(existsSync(keep)).toBe(true);
  });

  it("refuses a path outside the recordings folder", () => {
    const outside = take("elsewhere", SCRATCH);

    expect(deleteRecording(outside, ROOT)).toBe(false);
    expect(existsSync(outside)).toBe(true);
  });

  it("refuses a sibling whose name merely starts with the root's", () => {
    // `startsWith(root)` without the separator would accept this and delete
    // somebody's unrelated folder.
    const sibling = take("Prequel-backups", SCRATCH);

    expect(deleteRecording(sibling, ROOT)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
  });

  it("refuses to climb out with ..", () => {
    const escape = join(ROOT, "..", "elsewhere-2");
    mkdirSync(escape, { recursive: true });

    expect(deleteRecording(escape, ROOT)).toBe(false);
    expect(existsSync(escape)).toBe(true);
  });

  it("reports failure rather than throwing on a path that is not there", () => {
    // A discard that races a manual delete in Finder must not take the stop
    // path down with it.
    expect(() => deleteRecording(join(ROOT, "never-existed"), ROOT)).not.toThrow();
  });
});
