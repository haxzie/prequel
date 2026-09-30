/**
 * What the record of an export has to get right.
 *
 * Three properties, and every one of them fails quietly. A ledger that
 * remembers a file which has been deleted is a pane of rows that do nothing on
 * click. Two exports sharing a basename must not share an id, or the pane
 * previews one of them twice and drags the wrong file out. And the two things
 * a renderer can ask for — keep this still, open this file — must refuse a path
 * that is not one of ours, because the renderer is where a path is least
 * trusted.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_DATA = mkdtempSync(join(tmpdir(), "prequel-exports-data-"));
const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-exports-"));
afterAll(() => {
  rmSync(USER_DATA, { recursive: true, force: true });
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** Every path `shell.openPath` was handed, so a refusal can be told from a call. */
const opened: string[] = [];

vi.mock("electron", () => ({
  app: { getPath: () => USER_DATA },
  shell: {
    openPath: async (path: string) => {
      opened.push(path);
      return "";
    },
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
}));

/**
 * The module, with an empty ledger.
 *
 * Imported per case rather than once at the top: the ledger is held in memory
 * for the life of the process, which is the point of it — so a fresh one means
 * a fresh module.
 */
async function fresh() {
  vi.resetModules();
  rmSync(join(USER_DATA, "exports.json"), { force: true });
  rmSync(join(USER_DATA, "exports"), { recursive: true, force: true });
  return await import("./exports.js");
}

/** A file standing in for an export, wherever the save dialog put it. */
function wrote(name: string, folder = SCRATCH): string {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  writeFileSync(path, "video");
  return path;
}

/** The only shape the still cache accepts. */
const JPEG = `data:image/jpeg;base64,${Buffer.from("a still").toString("base64")}`;

beforeEach(() => {
  opened.length = 0;
});

describe("the ledger", () => {
  it("lists what was written, newest first", async () => {
    const { listExports, recordExport } = await fresh();

    recordExport(wrote("First.mp4"), null, 1000);
    recordExport(wrote("Second.mp4"), null, 2000);

    expect(listExports().map((entry) => entry.name)).toEqual(["Second.mp4", "First.mp4"]);
  });

  it("drops an export that is no longer on disk", async () => {
    const { exportId, exportPath, listExports, recordExport } = await fresh();

    const gone = wrote("Deleted.mp4");
    recordExport(gone, null);
    recordExport(wrote("Kept.mp4"), null);
    rmSync(gone);

    // Dropped rather than shown greyed out: an export is a file the user did
    // what they liked with, and a row for one that is not there cannot be
    // opened, revealed or dragged.
    expect(listExports().map((entry) => entry.name)).toEqual(["Kept.mp4"]);
    // And forgotten with it, so the next listing does not stat it again.
    expect(exportPath(exportId(gone))).toBeNull();
  });

  it("replaces the entry when the same path is exported over", async () => {
    const { listExports, recordExport } = await fresh();

    const path = wrote("Again.mp4");
    recordExport(path, null, 1000);
    recordExport(path, null, 2000);

    expect(listExports()).toHaveLength(1);
    expect(listExports()[0]?.createdAt).toBe(2000);
  });

  it("names the folder the file is in, not the file", async () => {
    const { listExports, recordExport } = await fresh();

    const path = wrote("Somewhere.mp4");
    recordExport(path, null);

    // The column the pane exists for: exports scatter across Downloads, the
    // Desktop and wherever the sheet was last pointed, and which one this
    // went to is what nobody remembers a week later.
    expect(listExports()[0]?.folder).toBe(SCRATCH);
    expect(listExports()[0]?.folder).not.toContain("Somewhere.mp4");
  });

  it("keeps the length it was given, and answers null without one", async () => {
    const { listExports, recordExport } = await fresh();

    // Recorded oldest first: the ledger keeps write order, which is the order
    // exports actually happen in.
    recordExport(wrote("Untimed.mp4"), null, 1000);
    recordExport(wrote("Timed.mp4"), 154_000, 2000);

    const [timed, untimed] = listExports();
    expect(timed?.durationMs).toBe(154_000);
    // Null and not zero. Every export anybody already has was written before
    // lengths were kept, and `0:00` beside a video that plays for a minute is
    // a wrong answer where a dash is an honest one.
    expect(untimed?.durationMs).toBeNull();
  });

  it("reports the size the file is now", async () => {
    const { listExports, recordExport } = await fresh();

    const path = wrote("Size.mp4");
    recordExport(path, null);
    writeFileSync(path, "a much longer video than before");

    // Stat'd on every listing rather than stored, so a re-export over the same
    // path is not reported at the size the first one was.
    expect(listExports()[0]?.bytes).toBe(31);
  });
});

describe("the id a file is served under", () => {
  it("differs for two exports of the same name in different folders", async () => {
    const { exportId } = await fresh();

    // The case a basename cannot survive: the save sheet lets the name be
    // typed over, so two folders holding `Export.mp4` is ordinary — and keyed
    // by name the second would be served for the first.
    expect(exportId(join(SCRATCH, "one", "Export.mp4"))).not.toBe(
      exportId(join(SCRATCH, "two", "Export.mp4")),
    );
  });

  it("refuses a still whose name is not one of ours", async () => {
    const { exportId, exportThumbnailPath } = await fresh();

    expect(exportThumbnailPath("../../evil.jpg")).toBeNull();
    expect(exportThumbnailPath("anything.jpg")).toBeNull();
    expect(exportThumbnailPath(`${exportId("/tmp/a.mp4")}.jpg`)).toContain(".jpg");
  });
});

describe("what a renderer may ask for", () => {
  it("refuses to open a path that was never exported", async () => {
    const { openExport, recordExport } = await fresh();

    recordExport(wrote("Mine.mp4"), null);
    await openExport("/etc/passwd");

    expect(opened).toEqual([]);
  });

  it("opens one that was", async () => {
    const { openExport, recordExport } = await fresh();

    const path = wrote("Opens.mp4");
    recordExport(path, null);
    await openExport(path);

    expect(opened).toEqual([path]);
  });

  it("refuses a still that is not a JPEG data URL", async () => {
    const { listExports, recordExport, saveExportThumbnail } = await fresh();

    const path = wrote("Still.mp4");
    recordExport(path, null);
    // Whatever `Buffer.from` made of this would be written to disk and served
    // back to a window as an image.
    saveExportThumbnail(path, "<script>not a picture</script>");

    expect(listExports()[0]?.thumbnail).toBeNull();
  });

  it("keeps one that is, and serves it back", async () => {
    const { listExports, recordExport, saveExportThumbnail } = await fresh();

    const path = wrote("Kept-still.mp4");
    recordExport(path, null);
    saveExportThumbnail(path, JPEG);

    expect(listExports()[0]?.thumbnail).toContain("export-thumb");
  });
});
