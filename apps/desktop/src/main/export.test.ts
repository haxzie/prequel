/**
 * What the ledger is told when an export finishes.
 *
 * One assertion, and it exists because the thing it checks was wrong in a way
 * nothing could see. `finish` clears `running` on its first line and read it
 * seventy lines later to say which recording the file came out of — so every
 * export was recorded as belonging to no recording, and every recording's
 * Exports tab was empty whatever had been exported from it. Nothing failed, no
 * log said anything, and the pane looked exactly like one for a recording
 * nobody had exported yet.
 *
 * Driven through `saveStill`, which is the shortest path to `finish`: it writes
 * a file and finishes, where a video goes through the render thread. Both call
 * the same function, which is the one under test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-export-"));
let chosen: string | null = null;

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

vi.mock("electron", () => ({
  app: { getPath: () => SCRATCH },
  clipboard: { writeBuffer: () => undefined },
  dialog: {
    showSaveDialog: async () => ({ canceled: chosen === null, filePath: chosen ?? undefined }),
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
}));

/** Everything the ledger was told, which is what this file is about. */
const recorded: { path: string; dir: string | null }[] = [];

vi.mock("./exports.js", () => ({
  recordExport: (path: string, _ms: number | null, dir: string | null = null) =>
    void recorded.push({ path, dir }),
}));

vi.mock("./analytics.js", () => ({ track: () => undefined }));
vi.mock("./broadcast.js", () => ({ toEveryWindow: () => undefined }));
vi.mock("./errors.js", () => ({ redact: (text: string) => text, reportError: () => undefined }));
vi.mock("./log.js", () => ({ log: () => undefined }));
vi.mock("./media-protocol.js", () => ({ publishExport: () => "prequel-media://export/1" }));
vi.mock("./recorder.js", () => ({ getRecorder: async () => ({}) }));
vi.mock("./library.js", () => ({ libraryDir: () => SCRATCH }));

const { saveStill } = await import("./export.js");

describe("a finished export", () => {
  beforeEach(() => {
    recorded.length = 0;
    chosen = join(SCRATCH, `shot-${String(recorded.length)}-${String(Date.now())}.png`);
  });

  it("is recorded against the recording it came out of", async () => {
    const dir = "/takes/Prequel 2026-11-05 08-42-56";

    await saveStill(dir, Buffer.from("a picture"), null);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.dir).toBe(dir);
  });

  it("is still recorded when the save sheet was cancelled by nobody", async () => {
    // Two in a row, because the flag this reads is module state: the first
    // export clearing it must not leave the second one orphaned.
    await saveStill("/takes/one", Buffer.from("one"), null);
    chosen = join(SCRATCH, "second.png");
    await saveStill("/takes/two", Buffer.from("two"), null);

    expect(recorded.map((entry) => entry.dir)).toEqual(["/takes/one", "/takes/two"]);
  });
});
