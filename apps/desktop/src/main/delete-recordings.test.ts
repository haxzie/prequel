/**
 * Deleting several recordings at once.
 *
 * This moves whole directory trees on paths that arrive from a renderer, behind
 * a confirmation somebody is going to read once and then trust. Three things
 * have to hold, and each fails in a way nobody would notice until the files
 * were gone: the sheet is shown **once** for the whole selection, a path
 * outside the recordings folder is refused **before** the sheet rather than
 * after, and one recording that will not move does not take the rest with it.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-delete-many-"));
const ROOT = join(SCRATCH, "Prequel", ".recordings");
process.env["PREQUEL_RECORDINGS_DIR"] = join(SCRATCH, "Prequel");

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** Every message box put up, so "one sheet for the selection" can be asserted. */
const sheets: { message: string }[] = [];
/** What the next sheet answers. 0 is Move to Trash, 1 is Cancel. */
let answer = 0;
/** Everything handed to the Trash, and anything that refuses to go. */
const trashed: string[] = [];
let refuses: string | null = null;

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  dialog: {
    showMessageBox: async (_window: unknown, options: { message: string }) => {
      sheets.push({ message: options.message });
      return { response: answer };
    },
  },
  shell: {
    trashItem: async (path: string) => {
      if (path === refuses) throw new Error("the Trash would not take it");
      trashed.push(path);
      rmSync(path, { recursive: true, force: true });
    },
    openPath: async () => "",
    showItemInFolder: () => undefined,
  },
}));

const { deleteRecording, deleteRecordings } = await import("./editor-session.js");

/** A recording directory with a file in it, so the delete has to recurse. */
function take(name: string, root = ROOT): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "screen.mp4"), "not really a video");
  return path;
}

beforeEach(() => {
  sheets.length = 0;
  trashed.length = 0;
  answer = 0;
  refuses = null;
});

describe("deleting several", () => {
  it("asks once for the whole selection", async () => {
    const dirs = [take("Prequel 1"), take("Prequel 2"), take("Prequel 3")];

    const deleted = await deleteRecordings(dirs, null);

    // One sheet, not three. Three in a row is not three decisions — it is one
    // decision and two obstacles, and the last is dismissed without being read.
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.message).toBe("Delete 3 recordings?");
    expect(deleted).toEqual(dirs);
    expect(dirs.some(existsSync)).toBe(false);
  });

  it("names the one when there is only one", async () => {
    const dir = take("Prequel 2026-09-30 11-20-19");

    await deleteRecordings([dir], null);

    expect(sheets[0]?.message).toBe('Delete "Prequel 2026-09-30 11-20-19"?');
  });

  it("deletes nothing when the sheet is declined", async () => {
    answer = 1;
    const dirs = [take("Kept 1"), take("Kept 2")];

    expect(await deleteRecordings(dirs, null)).toEqual([]);
    expect(trashed).toEqual([]);
    expect(dirs.every(existsSync)).toBe(true);
  });

  it("refuses a path outside the recordings folder, before asking", async () => {
    const outside = take("elsewhere", SCRATCH);

    const deleted = await deleteRecordings([outside], null);

    // No sheet at all. A confirmation for work that is then silently refused
    // teaches the user that pressing Delete sometimes does nothing.
    expect(sheets).toHaveLength(0);
    expect(deleted).toEqual([]);
    expect(existsSync(outside)).toBe(true);
  });

  it("counts only what it would actually delete", async () => {
    const inside = take("Prequel 4");
    const outside = take("elsewhere-too", SCRATCH);

    await deleteRecordings([inside, outside], null);

    // Not "Delete 2 recordings?" over a selection that only ever had one in it.
    expect(sheets[0]?.message).toBe('Delete "Prequel 4"?');
    expect(existsSync(outside)).toBe(true);
  });

  it("carries on past one that will not move", async () => {
    const stuck = take("Stuck");
    const fine = take("Fine");
    refuses = stuck;

    const deleted = await deleteRecordings([stuck, fine], null);

    // The others were perfectly deletable and the user asked for all of them.
    // The one that stayed is visible as a tile that is still there.
    expect(deleted).toEqual([fine]);
    expect(existsSync(stuck)).toBe(true);
    expect(existsSync(fine)).toBe(false);
  });
});

describe("deleting one", () => {
  it("still answers true and false", async () => {
    const dir = take("Prequel 5");
    expect(await deleteRecording(dir, null)).toBe(true);

    answer = 1;
    const kept = take("Prequel 6");
    expect(await deleteRecording(kept, null)).toBe(false);
    expect(existsSync(kept)).toBe(true);
  });
});
