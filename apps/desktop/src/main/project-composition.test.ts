/**
 * Which frame the library's tile pictures, and which file it comes out of.
 *
 * Both fail silently. A still taken at a quarter of the *file* can land in
 * footage the edit trimmed away — the tile then shows something the video does
 * not contain — and a camera seeked on the session clock rather than its own is
 * several hundred milliseconds out, which reads as a camera that is simply
 * pointing somewhere else.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { MANIFEST_FILE_NAME, MANIFEST_VERSION } from "../shared/manifest.js";
import { PROJECT_FILE_NAME } from "../shared/project.js";

vi.mock("electron", () => ({
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
  dialog: { showSaveDialog: async () => ({ canceled: true }) },
  app: { getPath: () => tmpdir() },
}));

// The addon, which this path never reaches: a composition is read off disk.
vi.mock("./recorder.js", () => ({ getRecorder: async () => ({ probeSession: async () => [] }) }));

const { readComposition } = await import("./project-composition.js");

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-composition-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const SECOND = 1_000_000_000;

/** A recording with a screen track, and optionally a camera that opened late. */
function recording(name: string, cameraStart?: number): string {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });

  const tracks = [
    {
      kind: "screen",
      segments: [{ file_name: "screen.mp4", start: 0, end: 10 * SECOND, samples: 600, dropped: 0 }],
    },
  ];

  if (cameraStart !== undefined) {
    tracks.push({
      kind: "camera",
      segments: [
        { file_name: "camera.mp4", start: cameraStart, end: 10 * SECOND, samples: 500, dropped: 0 },
      ],
    });
  }

  writeFileSync(
    join(dir, MANIFEST_FILE_NAME),
    JSON.stringify({
      version: MANIFEST_VERSION,
      id: name,
      started_at: new Date().toISOString(),
      duration: 10 * SECOND,
      source: { kind: "display", id: 1, title: "Screen", scale_factor: 2 },
      takes: [{ start: 0, end: 10 * SECOND }],
      tracks,
    }),
  );

  return dir;
}

/** A project that keeps one span of the recording and nothing else. */
function keeping(dir: string, id: string, start: number, end: number): void {
  writeFileSync(
    join(dir, PROJECT_FILE_NAME),
    JSON.stringify({
      version: 1,
      recordingId: id,
      tracks: [
        {
          id: "track",
          kind: "composite",
          slices: [{ id: "slice", source: { start, end }, speed: 1, overrides: {} }],
        },
      ],
    }),
  );
}

describe("readComposition", () => {
  it("takes the still from a quarter of the way through the recording", async () => {
    const spec = await readComposition(recording("whole"), SCRATCH);

    expect(spec?.screen?.at).toBeCloseTo(2.5);
  });

  it("takes it from the kept material, not the trimmed file", async () => {
    const dir = recording("trimmed");
    // Everything before the eighth second is cut. A quarter of the two seconds
    // that survive is 8.5s into the file — a quarter of the *file* is 2.5s,
    // which this edit no longer contains.
    keeping(dir, "trimmed", 8 * SECOND, 10 * SECOND);

    const spec = await readComposition(dir, SCRATCH);

    expect(spec?.screen?.at).toBeCloseTo(8.5);
  });

  it("seeks a late camera on its own clock", async () => {
    // Session media is zero-based: the camera's first sample is the start of
    // its file whatever the manifest says the session clock was at.
    const spec = await readComposition(recording("late-camera", 2 * SECOND), SCRATCH);

    expect(spec?.screen?.at).toBeCloseTo(2.5);
    expect(spec?.camera?.at).toBeCloseTo(0.5);
  });

  it("refuses a directory outside the recordings folder", async () => {
    const outside = mkdtempSync(join(tmpdir(), "prequel-elsewhere-"));

    expect(await readComposition(outside, SCRATCH)).toBeNull();

    rmSync(outside, { recursive: true, force: true });
  });
});
