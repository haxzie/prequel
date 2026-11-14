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

const { saveStill, progressLine } = await import("./export.js");

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

/**
 * What a running export says about itself, and how often.
 *
 * It said nothing at all until now: `export started`, then minutes or hours of
 * silence, then `export done`. A render that was simply very big and a render
 * that had stopped dead left an identical log, which is the one failure a user
 * cannot investigate and the one a bug report cannot answer — and both of the
 * reports this came out of arrived that way.
 */
describe("a running export", () => {
  const S = 1000;
  const progress = { framesDone: 9_000, framesTotal: 108_000 };

  it("says nothing until the reporting interval is up", () => {
    // Per-frame would be eighteen thousand lines for a five-minute export,
    // which buries the lifecycle breadcrumbs somebody opened the log to find.
    expect(progressLine(progress, 0, 60 * S, 70 * S)).toBeNull();
    expect(progressLine(progress, 0, 60 * S, 89 * S)).toBeNull();
    expect(progressLine(progress, 0, 60 * S, 90 * S)).not.toBeNull();
  });

  it("says the rate and what is left, not a percentage", () => {
    // Nine thousand frames in five minutes is 30 a second, so the other
    // ninety-nine thousand are fifty-five minutes away. That estimate is the
    // whole diagnosis for an export nobody should wait for.
    const line = progressLine(progress, 0, 0, 300 * S);

    expect(line?.frames).toBe("9000/108000");
    expect(line?.fps).toBe(30);
    expect(line?.elapsed_min).toBe(5);
    expect(line?.left_min).toBe(55);
  });

  it("offers no estimate before there is a rate to make one from", () => {
    // Nothing rendered yet divides by zero, and a `left_min` of `Infinity` in
    // the log reads as a bug in the logging rather than as an export that has
    // not started moving.
    const line = progressLine({ framesDone: 0, framesTotal: 108_000 }, 0, 0, 30 * S);

    expect(line?.fps).toBe(0);
    expect(line?.left_min).toBeNull();
  });
});
