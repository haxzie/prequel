/**
 * A take interrupted part way through has to come back as a recording.
 *
 * The property under test is the one that cost the footage before: a directory
 * holding real media and no `session.json` is invisible to the whole app. So
 * recovery has to produce a manifest that `parseManifest` accepts and that
 * names the files actually on disk — and it has to leave a finished take, and
 * an empty one, exactly as it found them.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
}));

import type { Manifest } from "../shared/manifest.js";
import {
  CAMERA_MATTE_FILE_NAME,
  MANIFEST_FILE_NAME,
  MANIFEST_VERSION,
  parseManifest,
} from "../shared/manifest.js";
import type { Recorder, TrackProbe } from "./recorder.js";

const { setRecorder } = await import("./recorder.js");
const { CAPTURE_MARKER_FILE_NAME, markCapturing, clearCapturing, recoverInterruptedTakes } =
  await import("./recover.js");

const S = 1_000_000_000;

const ROOT = mkdtempSync(join(tmpdir(), "prequel-recover-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
afterEach(() => setRecorder(null));

let library = "";
let counter = 0;

beforeEach(() => {
  library = join(ROOT, `library-${String((counter += 1))}`);
  mkdirSync(library, { recursive: true });
});

/** A recorder that reports whatever the files in a directory are meant to be. */
function probing(probes: Record<string, TrackProbe[]>): void {
  setRecorder({
    probeSession: async (dir: string) => probes[dir] ?? [],
  } as unknown as Recorder);
}

function probe(kind: string, duration: number, size?: [number, number]): TrackProbe {
  return {
    kind,
    fileName: `${kind}.mp4`,
    start: 0,
    duration,
    width: size?.[0],
    height: size?.[1],
    frameRate: size ? 60 : undefined,
  } as TrackProbe;
}

/** A directory as an interrupted capture leaves one: media, marker, no manifest. */
function interrupted(name: string, files = ["screen.mp4"]): string {
  const dir = join(library, name);
  mkdirSync(dir, { recursive: true });
  for (const file of files) writeFileSync(join(dir, file), "media");
  markCapturing(dir, {
    started_at: "2026-10-05T09:00:00.000Z",
    source: { kind: "display", id: 7, title: "", app_name: "", scale_factor: 2 },
    cursor_baked: false,
  });
  return dir;
}

function read(dir: string): Manifest {
  return parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
}

describe("recoverInterruptedTakes", () => {
  it("writes a manifest for a take that was never stopped", async () => {
    const dir = interrupted("Prequel 1");
    probing({ [dir]: [probe("screen", 12 * S, [1920, 1080])] });

    expect(await recoverInterruptedTakes(library)).toEqual([dir]);

    const manifest = read(dir);
    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.duration).toBe(12 * S);
    expect(manifest.started_at).toBe("2026-10-05T09:00:00.000Z");
    expect(manifest.source.id).toBe(7);
    expect(manifest.tracks).toHaveLength(1);
    expect(manifest.tracks[0]?.segments[0]).toMatchObject({
      file_name: "screen.mp4",
      start: 0,
      end: 12 * S,
      width: 1920,
      height: 1080,
    });
    // The marker is the only thing that says a take needs rebuilding. Left
    // behind, every later launch would rebuild this one again — over whatever
    // the editor had since written.
    expect(existsSync(join(dir, CAPTURE_MARKER_FILE_NAME))).toBe(false);
  });

  it("puts every track that survived on one clock", async () => {
    const dir = interrupted("Prequel 1", ["screen.mp4", "camera.mp4", "mic.m4a"]);
    probing({
      [dir]: [
        probe("screen", 30 * S, [1920, 1080]),
        probe("camera", 29 * S, [1280, 720]),
        probe("microphone", 30 * S),
      ],
    });

    await recoverInterruptedTakes(library);

    const manifest = read(dir);
    expect(manifest.tracks.map((track) => track.kind)).toEqual(["screen", "camera", "microphone"]);
    // Zero for all three: the real offsets were in memory, and every session
    // file is written zero-based, so nothing on disk remembers them.
    expect(manifest.tracks.every((track) => track.segments[0]?.start === 0)).toBe(true);
    // The screen's, not the longest: it is the track that anchors the clock.
    expect(manifest.duration).toBe(30 * S);
  });

  it("keeps the camera's matte, so background removal survives", async () => {
    const dir = interrupted("Prequel 1", ["camera.mp4", CAMERA_MATTE_FILE_NAME]);
    probing({ [dir]: [probe("camera", 5 * S, [1280, 720])] });

    await recoverInterruptedTakes(library);

    expect(read(dir).tracks[0]?.segments[0]?.matte?.file_name).toBe(CAMERA_MATTE_FILE_NAME);
  });

  it("discards a take that captured nothing", async () => {
    const dir = interrupted("Prequel 1");
    probing({ [dir]: [probe("screen", 0)] });

    await recoverInterruptedTakes(library);

    // No manifest would leave a folder the next pass walks for ever, and a
    // manifest would put a tile in the grid that opens on nothing.
    expect(existsSync(dir)).toBe(false);
  });

  it("keeps footage it cannot reassemble rather than deleting it", async () => {
    const dir = interrupted("Prequel 1");
    // A process killed outright leaves an `AVAssetWriter` that never wrote its
    // `moov` atom: megabytes of real video that no decoder will open. Nothing
    // here can turn that back into a recording, which is not a licence to
    // throw away the only copy of it.
    writeFileSync(join(dir, "screen.mp4"), Buffer.alloc(4_000_000));
    probing({ [dir]: [] });

    expect(await recoverInterruptedTakes(library)).toEqual([]);
    expect(existsSync(join(dir, "screen.mp4"))).toBe(true);
    // The marker goes either way: nothing about the file will be different on
    // the next launch, and a take re-probed for ever is the pass walking past
    // the same folder every time the app opens.
    expect(existsSync(join(dir, CAPTURE_MARKER_FILE_NAME))).toBe(false);
  });

  it("leaves a take that stopped properly alone", async () => {
    const dir = interrupted("Prequel 1");
    const manifest = JSON.stringify({
      version: MANIFEST_VERSION,
      id: "Prequel 1",
      started_at: "2026-10-05T09:00:00.000Z",
      duration: 3 * S,
      source: { kind: "display", id: 7, title: "", scale_factor: 2 },
      tracks: [
        {
          kind: "screen",
          segments: [{ file_name: "screen.mp4", start: 0, end: 3 * S, samples: 180, dropped: 0 }],
        },
      ],
      takes: [{ start: 0, end: 3 * S }],
      cursor: [{ at: 0, x: 0.5, y: 0.5 }],
    });
    writeFileSync(join(dir, MANIFEST_FILE_NAME), manifest);
    probing({ [dir]: [probe("screen", 3 * S, [1920, 1080])] });

    expect(await recoverInterruptedTakes(library)).toEqual([]);

    // Byte-identical. A rebuild here would replace a manifest holding a whole
    // pointer track with one holding none.
    expect(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8")).toBe(manifest);
    expect(existsSync(join(dir, CAPTURE_MARKER_FILE_NAME))).toBe(false);
  });

  it("recovers a take interrupted while adding footage", async () => {
    const recording = join(library, "Prequel 1");
    mkdirSync(join(recording, "2"), { recursive: true });
    const base = JSON.stringify({ version: MANIFEST_VERSION, tracks: [], takes: [] });
    writeFileSync(join(recording, MANIFEST_FILE_NAME), base);
    writeFileSync(join(recording, "2", "screen.mp4"), "media");
    markCapturing(join(recording, "2"), {
      started_at: "2026-10-05T09:30:00.000Z",
      source: { kind: "display", id: 7, title: "", app_name: "", scale_factor: 2 },
      cursor_baked: false,
    });
    probing({ [join(recording, "2")]: [probe("screen", 4 * S, [1920, 1080])] });

    expect(await recoverInterruptedTakes(library)).toEqual([join(recording, "2")]);

    // Its own manifest, which is what `mergeUnmergedTakes` folds into the
    // recording on the next open — the same path an orphan take already takes.
    expect(read(join(recording, "2")).duration).toBe(4 * S);
    expect(readFileSync(join(recording, MANIFEST_FILE_NAME), "utf8")).toBe(base);
  });

  it("recovers a take whose marker cannot be read", async () => {
    const dir = interrupted("Prequel 1");
    writeFileSync(join(dir, CAPTURE_MARKER_FILE_NAME), "{ not json");
    probing({ [dir]: [probe("screen", 8 * S, [1920, 1080])] });

    await recoverInterruptedTakes(library);

    // The footage is the irreplaceable part; how the editor frames it on the
    // first open is not.
    expect(read(dir).duration).toBe(8 * S);
  });

  it("recovers what it can when one take is unreadable", async () => {
    const broken = interrupted("Prequel 1");
    const good = interrupted("Prequel 2");
    setRecorder({
      probeSession: async (dir: string) => {
        if (dir === broken) throw new Error("no such file");
        return [probe("screen", 6 * S, [1920, 1080])];
      },
    } as unknown as Recorder);

    expect(await recoverInterruptedTakes(library)).toEqual([good]);
  });

  it("is a no-op on a library with nothing to recover", async () => {
    probing({});
    expect(await recoverInterruptedTakes(library)).toEqual([]);
    expect(await recoverInterruptedTakes(join(ROOT, "never-existed"))).toEqual([]);
  });
});

describe("the capture marker", () => {
  it("goes away when the take is stopped", () => {
    const dir = interrupted("Prequel 1");
    clearCapturing(dir);
    expect(existsSync(join(dir, CAPTURE_MARKER_FILE_NAME))).toBe(false);
    // Twice is not an error: a stop that races a recovery pass must not throw
    // out of the one path that finalises the writers.
    expect(() => clearCapturing(dir)).not.toThrow();
  });
});
