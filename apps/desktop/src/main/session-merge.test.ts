/**
 * Folding a take into the recording it extends must never cost the recording.
 *
 * The base `session.json` is the one irreplaceable index of what was captured: a
 * truncated one is not a lost edit, it is a recording that no longer opens. So
 * every failure here has to leave it byte-identical, and the take's own footage
 * and manifest have to survive to be merged on the next open.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
}));

import type { Manifest } from "../shared/manifest.js";
import { MANIFEST_FILE_NAME, MANIFEST_VERSION, parseManifest } from "../shared/manifest.js";
import { newProject, PROJECT_FILE_NAME } from "../shared/project.js";
import type { Project } from "../shared/project.js";

const { mergeTake, mergeUnmergedTakes, takeFocus } = await import("./session-merge.js");
const { loadProject } = await import("./editor-project.js");

const S = 1_000_000_000;

const ROOT = mkdtempSync(join(tmpdir(), "prequel-merge-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

let dir = "";
let counter = 0;

beforeEach(() => {
  dir = join(ROOT, `Prequel ${String((counter += 1))}`);
  mkdirSync(dir, { recursive: true });
});

/**
 * A one-take manifest, as a fresh capture writes one.
 *
 * `mic` optional so the asymmetric cases — a microphone on for one take and off
 * for the other — can be built either way round.
 */
function manifest(duration: number, options: { mic?: boolean; camera?: boolean } = {}): Manifest {
  return {
    version: MANIFEST_VERSION,
    id: "Prequel 1",
    started_at: "2026-08-11T12:00:00Z",
    duration,
    source: { kind: "display", id: 1, title: "Display", scale_factor: 2 },
    tracks: [
      {
        kind: "screen",
        segments: [
          {
            file_name: "screen.mp4",
            start: 0,
            end: duration,
            width: 1920,
            height: 1080,
            samples: 60,
            dropped: 0,
          },
        ],
      },
      ...(options.camera
        ? [
            {
              kind: "camera" as const,
              segments: [
                {
                  file_name: "camera.mp4",
                  // A late device, which is the whole reason the offset is per
                  // file rather than per take.
                  start: 200_000_000,
                  end: duration,
                  width: 1280,
                  height: 720,
                  samples: 30,
                  dropped: 0,
                  matte: {
                    file_name: "camera-matte.mp4",
                    width: 512,
                    height: 288,
                    samples: 30,
                    dropped: 0,
                  },
                },
              ],
            },
          ]
        : []),
      ...(options.mic
        ? [
            {
              kind: "microphone" as const,
              segments: [
                { file_name: "mic.m4a", start: 0, end: duration, samples: 480, dropped: 0 },
              ],
            },
          ]
        : []),
    ],
    takes: [{ dir: "", start: 0, end: duration }],
    cursor_baked: false,
    cursor: [{ at: 0, x: 0.5, y: 0.5 }],
    clicks: [{ at: duration / 2, x: 0.2, y: 0.2 }],
    typing: [{ at: duration / 4, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
    keys: [{ start: duration / 4, end: duration / 2 }],
    key_presses: [{ at: duration / 3, class: "letter" }],
  };
}

/** Writes the base recording and one take beside it, and returns the take's path. */
function withTake(
  base: Manifest,
  take: Manifest | string,
  name = "2",
): { dir: string; takeDir: string } {
  writeFileSync(join(dir, MANIFEST_FILE_NAME), JSON.stringify(base));

  const takeDir = join(dir, name);
  mkdirSync(takeDir, { recursive: true });
  writeFileSync(
    join(takeDir, MANIFEST_FILE_NAME),
    typeof take === "string" ? take : JSON.stringify(take),
  );

  return { dir, takeDir };
}

function merged(): Manifest {
  return parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
}

function project(): Project {
  return JSON.parse(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")) as Project;
}

describe("mergeTake", () => {
  it("lays the take's segments after the recording's, naming them through its directory", () => {
    const { takeDir } = withTake(
      manifest(10 * S, { camera: true }),
      manifest(6 * S, { camera: true }),
    );

    expect(mergeTake(dir, takeDir)).toEqual({ sliceId: expect.any(String), at: 10 * S });

    const after = merged();
    expect(after.duration).toBe(16 * S);
    expect(after.takes).toEqual([
      { dir: "", start: 0, end: 10 * S },
      { dir: "2", start: 10 * S, end: 16 * S },
    ]);

    const screen = after.tracks.find((track) => track.kind === "screen")!;
    expect(screen.segments.map((segment) => segment.file_name)).toEqual([
      "screen.mp4",
      "2/screen.mp4",
    ]);
    expect(screen.segments[1]).toMatchObject({ start: 10 * S, end: 16 * S });

    // The late camera stays late, on the parent's clock. Flattening it to the
    // seam would slide take two's camera 200 ms early against its own screen.
    const camera = after.tracks.find((track) => track.kind === "camera")!;
    expect(camera.segments[1]!.start).toBe(10 * S + 200_000_000);
    // The matte comes with it, under the same prefix — it is this segment's
    // camera's sidecar and no other's.
    expect(camera.segments[1]!.matte?.file_name).toBe("2/camera-matte.mp4");
  });

  it("shifts every sample array and leaves them in clock order", () => {
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S));
    mergeTake(dir, takeDir);

    const after = merged();
    expect(after.cursor?.map((sample) => sample.at)).toEqual([0, 10 * S]);
    expect(after.clicks?.map((sample) => sample.at)).toEqual([5 * S, 13 * S]);
    expect(after.typing?.map((sample) => sample.at)).toEqual([2.5 * S, 11.5 * S]);
    expect(after.keys).toEqual([
      { start: 2.5 * S, end: 5 * S },
      { start: 11.5 * S, end: 13 * S },
    ]);
    expect(after.key_presses?.map((press) => press.at)).toEqual([(10 * S) / 3, 12 * S]);

    // Sorted by construction rather than by a sort: the take begins where the
    // recording ended, so appending cannot put anything out of order.
    const times = after.cursor!.map((sample) => sample.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("keeps the recording's identity, so the project and transcript still match it", () => {
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S));
    const before = merged();
    mergeTake(dir, takeDir);

    const after = merged();
    // All three unchanged. `id` is what `project.json` and `transcript.json` are
    // checked against, and a new one would silently discard both.
    expect(after.id).toBe(before.id);
    expect(after.started_at).toBe(before.started_at);
    expect(after.source).toEqual(before.source);
  });

  it("adds a track the recording did not have, starting at the seam", () => {
    // The microphone switched on for the addition and off for the original.
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S, { mic: true }));
    mergeTake(dir, takeDir);

    const mic = merged().tracks.find((track) => track.kind === "microphone")!;
    expect(mic.segments).toHaveLength(1);
    expect(mic.segments[0]).toMatchObject({ file_name: "2/mic.m4a", start: 10 * S, end: 16 * S });
  });

  it("leaves a track the addition did not record stopping at the seam", () => {
    // The other way round, and the case that must mix as silence rather than as
    // the first take's audio stretched over the second's footage.
    const { takeDir } = withTake(manifest(10 * S, { mic: true }), manifest(6 * S));
    mergeTake(dir, takeDir);

    const mic = merged().tracks.find((track) => track.kind === "microphone")!;
    expect(mic.segments).toHaveLength(1);
    expect(mic.segments[0]!.end).toBe(10 * S);
  });

  it("appends exactly one clip for the new footage", () => {
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S));
    // A recording that has been edited, so there is a project to append to. The
    // untouched case is the next test: it has no file at all.
    writeFileSync(join(dir, PROJECT_FILE_NAME), JSON.stringify(newProject("Prequel 1", 10 * S)));

    const result = mergeTake(dir, takeDir)!;

    const slices = project().tracks[0]!.slices;
    expect(slices.map((slice) => slice.source)).toEqual([
      { start: 0, end: 10 * S },
      { start: 10 * S, end: 16 * S },
    ]);
    expect(slices[1]!.id).toBe(result.sliceId);
    // No overrides. An override is a decision about one moment, and repeating the
    // previous clip's onto footage nobody has seen reads as a bug in the
    // background picker.
    expect(slices[1]!.overrides).toEqual({});
  });

  it("does not show the addition twice on a recording nobody has edited", () => {
    // No `project.json`, so the project is built fresh — and a fresh one is
    // already one clip per take, the new one included. Appending a second clip
    // over the same footage would play the addition twice.
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S));
    mergeTake(dir, takeDir);

    const opened = loadProject(dir, "Prequel 1", 16 * S, undefined, [10 * S]);
    expect(opened.tracks[0]!.slices.map((slice) => slice.source)).toEqual([
      { start: 0, end: 10 * S },
      { start: 10 * S, end: 16 * S },
    ]);
  });

  it("appends to the edit that was already there rather than replacing it", () => {
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S));
    // A recording somebody had already cut in two before adding to it.
    // Through the factory so it carries whatever the current version is: a
    // hand-written project at the wrong version is discarded by
    // `sanitiseProject`, and this test would then pass for the wrong reason.
    writeFileSync(
      join(dir, PROJECT_FILE_NAME),
      JSON.stringify({
        ...newProject("Prequel 1", 10 * S),
        tracks: [
          {
            id: "composite",
            kind: "composite",
            slices: [
              { id: "a", source: { start: 0, end: 3 * S }, speed: 1, overrides: {} },
              { id: "b", source: { start: 7 * S, end: 10 * S }, speed: 1, overrides: {} },
            ],
          },
        ],
      }),
    );

    mergeTake(dir, takeDir);

    expect(project().tracks[0]!.slices.map((slice) => slice.id)).toEqual([
      "a",
      "b",
      expect.any(String),
    ]);
  });

  it("appends for footage the edit stops short of", () => {
    // The shape a real recording turns into: trimmed down to a few fragments,
    // the last of which ends well before the seam. The clip for the addition
    // has to be appended on its own rather than found among what is there —
    // `already` looks for a slice reaching past the seam, and here nothing
    // reaches anywhere near it.
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S));
    writeFileSync(
      join(dir, PROJECT_FILE_NAME),
      JSON.stringify({
        ...newProject("Prequel 1", 10 * S),
        tracks: [
          {
            id: "composite",
            kind: "composite",
            slices: [{ id: "a", source: { start: 0, end: 2 * S }, speed: 1, overrides: {} }],
          },
        ],
      }),
    );

    mergeTake(dir, takeDir);

    const slices = project().tracks[0]!.slices;
    expect(slices).toHaveLength(2);
    // Covering the addition exactly, from the seam to the grown duration.
    expect(slices[1]!.source).toEqual({ start: 10 * S, end: 16 * S });
  });

  it("offers the new clip to the editor once, then forgets it", () => {
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S));
    const result = mergeTake(dir, takeDir)!;

    expect(takeFocus(dir)).toBe(result.sliceId);
    // Cleared as it is read: it describes the addition, not the recording, and
    // kept anywhere durable it would move the selection on every open for ever.
    expect(takeFocus(dir)).toBeNull();
  });

  it("leaves the recording untouched when the take's manifest will not parse", () => {
    const { takeDir } = withTake(manifest(10 * S), "{not json");
    const before = readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8");

    expect(mergeTake(dir, takeDir)).toBeNull();

    // Byte-identical, and no `project.json` written either. Nothing reaches the
    // base recording until the merged manifest is complete, which is what makes
    // a crash mid-merge recoverable.
    expect(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8")).toBe(before);
    expect(() => readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")).toThrow();
  });

  it("refuses a take with no footage in it", () => {
    // A directory with a manifest and nothing recorded. Merging it would put a
    // seam in the recording with nothing on the other side of it.
    const empty: Manifest = { ...manifest(0), duration: 0, tracks: [] };
    const { takeDir } = withTake(manifest(10 * S), empty);

    expect(mergeTake(dir, takeDir)).toBeNull();
    expect(merged().duration).toBe(10 * S);
  });

  it("is a no-op for a take already in the table", () => {
    const { takeDir } = withTake(manifest(10 * S), manifest(6 * S));
    mergeTake(dir, takeDir);

    // Idempotent by construction, which is what lets the recovery pass on open
    // run unconditionally.
    expect(mergeTake(dir, takeDir)).toBeNull();
    expect(merged().duration).toBe(16 * S);
    expect(merged().takes).toHaveLength(2);
  });
});

describe("mergeUnmergedTakes", () => {
  it("picks up a take whose merge never finished", () => {
    // The crash path: real footage in a numbered subdirectory the take table
    // does not mention. Deleting it silently is not an option.
    const { takeDir: _unused } = withTake(manifest(10 * S), manifest(6 * S));

    expect(mergeUnmergedTakes(dir)).toMatchObject({ at: 10 * S });
    expect(merged().duration).toBe(16 * S);

    // And nothing on the second pass, because the table now says so.
    expect(mergeUnmergedTakes(dir)).toBeNull();
  });

  it("merges several in the order they were recorded", () => {
    // The clock is built in order or the seams land in the wrong places — and
    // `readdir` does not promise numeric order.
    withTake(manifest(10 * S), manifest(6 * S), "2");
    const third = join(dir, "10");
    mkdirSync(third, { recursive: true });
    writeFileSync(join(third, MANIFEST_FILE_NAME), JSON.stringify(manifest(4 * S)));

    mergeUnmergedTakes(dir);

    expect(merged().takes).toEqual([
      { dir: "", start: 0, end: 10 * S },
      { dir: "2", start: 10 * S, end: 16 * S },
      { dir: "10", start: 16 * S, end: 20 * S },
    ]);
  });

  it("ignores a take whose own manifest will not parse", () => {
    // Warned about and left alone. Retried unconditionally it would be retried
    // on every open of the recording for ever.
    const { takeDir: _unused } = withTake(manifest(10 * S), "{not json");

    expect(mergeUnmergedTakes(dir)).toBeNull();
    expect(merged().duration).toBe(10 * S);
  });
});
