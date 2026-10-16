/**
 * What the quick view's Export actually exports.
 *
 * Two failures, both silent. A recording rendered without the first cut comes
 * out flat — no zooms, which is the whole claim of the app — and nobody would
 * see it happen: they would see a duller video than the same take makes by
 * hand. And a screenshot "exported" by re-rendering it would be the editor's
 * dressing on a picture nobody dressed; the file has to be the shot as taken.
 *
 * The render itself is mocked. What is being asserted is what it is handed and
 * what was written to disk before it ran, neither of which needs a GPU.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MANIFEST_FILE_NAME, MANIFEST_VERSION, STILL_FILE_NAME } from "../shared/manifest.js";
import { PROJECT_FILE_NAME, type Project } from "../shared/project.js";

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-quick-export-"));
const RECORDINGS = join(SCRATCH, "recordings");
const DOWNLOADS = join(SCRATCH, "Downloads");
process.env["PREQUEL_RECORDINGS_DIR"] = RECORDINGS;

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

vi.mock("electron", () => ({
  app: { getPath: () => DOWNLOADS },
  clipboard: { writeImage: () => undefined },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
}));

// Paid, so the licence is never the reason an assertion below fails.
vi.mock("./licence.js", () => ({
  entitlement: () => ({ status: "paid" }),
  refreshEntitlement: async () => ({ status: "paid" }),
}));

/** Every render asked for, so the test can read what it was handed. */
const renders: { dir: string; out: string | undefined }[] = [];

vi.mock("./render.js", () => ({
  renderRecording: async (dir: string, options: { out?: string }) => {
    renders.push({ dir, out: options.out });
    return { file: options.out ?? "", width: 1920, height: 1080, durationMs: 1000, bytes: 10 };
  },
}));

/** Exports the ledger was told about. */
const recorded: string[] = [];

vi.mock("./exports.js", () => ({
  recordExport: (path: string) => void recorded.push(path),
  isRecordedExport: () => true,
  revealExport: () => undefined,
}));

const { quickExport } = await import("./quick-export.js");
// The library's own folder inside it: a take lives in `.recordings`, and a
// directory anywhere else is refused.
const { SESSIONS_DIR } = await import("./session.js");

/**
 * A recording with two clicks a second apart, which is a cluster and so a zoom.
 *
 * Written as a manifest rather than recorded: `firstCut` reads this file and
 * `project.json`, and neither needs a video beside them.
 */
function recording(name: string, options: { still?: boolean } = {}): string {
  const dir = join(SESSIONS_DIR, name);
  mkdirSync(dir, { recursive: true });

  const second = 1_000_000_000;
  writeFileSync(
    join(dir, MANIFEST_FILE_NAME),
    JSON.stringify({
      version: MANIFEST_VERSION,
      id: name,
      started_at: new Date().toISOString(),
      duration: 10 * second,
      ...(options.still ? { still: true, cursor_baked: true } : {}),
      source: { kind: "display", id: 1, title: "Display", scale_factor: 2 },
      tracks: [
        {
          kind: "screen",
          segments: [
            {
              file_name: options.still ? STILL_FILE_NAME : "screen.mp4",
              start: 0,
              end: 10 * second,
              width: 1920,
              height: 1080,
              samples: options.still ? 1 : 600,
              dropped: 0,
            },
          ],
        },
      ],
      takes: [{ dir: "", start: 0, end: 10 * second }],
      clicks: [
        { at: 3 * second, x: 400, y: 300 },
        { at: 4 * second, x: 420, y: 310 },
      ],
    }),
  );

  if (options.still) writeFileSync(join(dir, STILL_FILE_NAME), "not really a picture");

  return dir;
}

beforeEach(() => {
  renders.length = 0;
  recorded.length = 0;
  mkdirSync(DOWNLOADS, { recursive: true });
});

describe("exporting a capture from the quick view", () => {
  it("makes the first cut before rendering, so the video is not flat", async () => {
    const dir = recording("take-with-clicks");

    await quickExport(dir, false);

    // Written to disk, not only passed along: the editor opened afterwards has
    // to show the same zooms the file was rendered with.
    const project = JSON.parse(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")) as Project;
    expect(project.zooms.length).toBeGreaterThan(0);
    expect(renders).toHaveLength(1);
    expect(renders[0]!.dir).toBe(dir);
  });

  it("writes into Downloads rather than beside the library", async () => {
    const dir = recording("take-for-downloads");

    const outcome = await quickExport(dir, false);

    expect(outcome.needsUpgrade).toBe(false);
    expect(renders[0]!.out?.startsWith(DOWNLOADS)).toBe(true);
    expect(outcome.path).toBe(renders[0]!.out);
  });

  it("copies a screenshot rather than rendering one", async () => {
    // The shot as it was taken. Anything else would be the editor's dressing
    // applied by nobody, on a picture somebody asked for as it is.
    const dir = recording("a-shot", { still: true });

    const outcome = await quickExport(dir, true);

    expect(renders).toHaveLength(0);
    expect(outcome.path?.startsWith(DOWNLOADS)).toBe(true);
    expect(outcome.path?.endsWith(".png")).toBe(true);
    expect(readFileSync(outcome.path!, "utf8")).toBe("not really a picture");
    // In the ledger, which is what Open in Finder and Copy are allowed by.
    expect(recorded).toEqual([outcome.path]);
  });

  it("refuses a directory outside the recordings folder", async () => {
    await expect(quickExport(join(SCRATCH, "elsewhere"), false)).rejects.toThrow(/outside/);
  });
});
