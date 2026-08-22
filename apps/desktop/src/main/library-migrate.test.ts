/**
 * This one moves the user's own footage, so the failure modes are the point.
 *
 * A take that is half-moved, a take overwritten by another with the same name,
 * or a take deleted because it looked like clutter are all unrecoverable in a
 * way a wrong pixel is not. So: renames only, refuse on collision, and leave
 * anything unrecognised exactly where it is.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = mkdtempSync(join(tmpdir(), "prequel-library-"));
process.env["PREQUEL_RECORDINGS_DIR"] = ROOT;

vi.mock("electron", () => ({
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
  app: { getPath: () => tmpdir() },
}));

const { migrateLibrary } = await import("./library-migrate.js");
const { MANIFEST_FILE_NAME } = await import("../shared/manifest.js");

const SESSIONS = join(ROOT, ".recordings");
const TAKE = "Prequel 2026-08-11 12-00-00";

/** A take in the old layout: a folder at the top with a manifest in it. */
function oldTake(name = TAKE, files: string[] = []): string {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE_NAME), "{}");
  writeFileSync(join(dir, "screen.mp4"), "video");
  for (const file of files) writeFileSync(join(dir, file), "export");
  return dir;
}

beforeEach(() => {
  for (const entry of readdirSync(ROOT))
    rmSync(join(ROOT, entry), { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

describe("migrateLibrary", () => {
  it("moves a take out of sight and lifts its exports up", () => {
    oldTake(TAKE, ["Export 2026-08-11 12-05-00.mp4"]);

    const result = migrateLibrary();

    expect(result).toMatchObject({ recordings: 1, exports: 1, failed: 0 });
    // The take's own files followed it.
    expect(existsSync(join(SESSIONS, TAKE, MANIFEST_FILE_NAME))).toBe(true);
    expect(existsSync(join(SESSIONS, TAKE, "screen.mp4"))).toBe(true);
    // The export is what is left at the top, on its own.
    expect(readdirSync(ROOT).sort()).toEqual([".recordings", "Export 2026-08-11 12-05-00.mp4"]);
  });

  it("does nothing the second time", () => {
    oldTake(TAKE, ["Export 2026-08-11 12-05-00.mp4"]);
    migrateLibrary();

    // Runs on every launch, so a no-op has to be genuinely free of side effects
    // rather than merely harmless.
    const again = migrateLibrary();

    expect(again).toMatchObject({ recordings: 0, exports: 0, failed: 0 });
    expect(readdirSync(SESSIONS)).toEqual([TAKE]);
  });

  it("refuses a collision rather than overwriting a take", () => {
    // Two takes claiming one name means one of them stops existing if a winner
    // is picked silently.
    oldTake(TAKE);
    mkdirSync(join(SESSIONS, TAKE), { recursive: true });
    writeFileSync(join(SESSIONS, TAKE, MANIFEST_FILE_NAME), '{"keep":true}');

    const result = migrateLibrary();

    expect(result).toMatchObject({ recordings: 0, failed: 1 });
    // Both still exist: the one already moved, untouched, and the loose one.
    expect(existsSync(join(ROOT, TAKE, MANIFEST_FILE_NAME))).toBe(true);
    expect(existsSync(join(SESSIONS, TAKE, MANIFEST_FILE_NAME))).toBe(true);
  });

  it("leaves anything that is not a take alone", () => {
    // A folder with no manifest is an interrupted capture or somebody else's
    // directory. Neither is ours to move.
    mkdirSync(join(ROOT, "Some folder"), { recursive: true });
    writeFileSync(join(ROOT, "holiday.mp4"), "not ours");

    const result = migrateLibrary();

    expect(result.recordings).toBe(0);
    expect(existsSync(join(ROOT, "Some folder"))).toBe(true);
    expect(existsSync(join(ROOT, "holiday.mp4"))).toBe(true);
  });

  it("keeps an export already at the top rather than moving over it", () => {
    const name = "Export 2026-08-11 12-05-00.mp4";
    oldTake(TAKE, [name]);
    writeFileSync(join(ROOT, name), "the one already there");

    migrateLibrary();

    // Same timestamp to the second means the same export; the copy at the top
    // wins and the take's is carried along with it rather than deleted.
    expect(existsSync(join(ROOT, name))).toBe(true);
    expect(existsSync(join(SESSIONS, TAKE, name))).toBe(true);
  });

  it("survives a library that does not exist yet", () => {
    rmSync(ROOT, { recursive: true, force: true });
    expect(() => migrateLibrary()).not.toThrow();
    mkdirSync(ROOT, { recursive: true });
  });
});
