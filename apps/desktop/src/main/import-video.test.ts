/**
 * What an imported video becomes.
 *
 * The properties worth pinning are the ones a wrong answer would hide until an
 * export: that the clip lands at the end of the recording rather than on top of
 * it, that a file with no sound is not given a sound track it cannot play, and
 * that the recording's pointer stops at the seam rather than freezing over
 * footage it was never in.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Before anything imports `session.js`: the take directory an abandoned import
// deletes has to be inside the recordings folder, which is the guard standing
// between a bug in a caller and somebody's home directory.
const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-import-"));
process.env["PREQUEL_RECORDINGS_DIR"] = SCRATCH;

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
}));

const { importVideo, importedManifest } = await import("./import-video.js");
const { setRecorder } = await import("./recorder.js");
const { MANIFEST_FILE_NAME, parseManifest, speechSegments } = await import("../shared/manifest.js");
const { untranscribed } = await import("../shared/transcript.js");
const { PROJECT_FILE_NAME } = await import("../shared/project.js");
const { flushProject, loadProject, saveProject } = await import("./editor-project.js");

const S = 1_000_000_000;

const ROOT = join(SCRATCH, ".recordings");
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

let dir = "";
let counter = 0;

/** A recording of `duration`, with one screen track and nothing else. */
function recording(duration: number, extra: Record<string, unknown> = {}): string {
  const path = join(ROOT, `recording-${(counter += 1)}`);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "screen.mp4"), "not really a video");
  writeFileSync(
    join(path, MANIFEST_FILE_NAME),
    JSON.stringify({
      version: 2,
      id: "recording-id",
      started_at: "2026-09-25T10:00:00.000Z",
      duration,
      source: { kind: "display", id: 1, title: "Display", scale_factor: 2 },
      tracks: [
        {
          kind: "screen",
          segments: [{ file_name: "screen.mp4", start: 0, end: duration, samples: 0, dropped: 0 }],
        },
      ],
      takes: [{ dir: "", start: 0, end: duration }],
      ...extra,
    }),
  );
  return path;
}

/** Somewhere to import from. The fake probe never opens it. */
function sourceFile(name = "Demo.mov"): string {
  const path = join(SCRATCH, name);
  writeFileSync(path, "not really a video either");
  return path;
}

/** The fake's probe answers with these; a test that needs another shape says so. */
function withProbe(probe: {
  duration: number;
  hasVideo?: boolean;
  hasAudio?: boolean;
  width?: number;
  height?: number;
  frameRate?: number;
}) {
  setRecorder({
    probeMedia: async () => ({
      hasVideo: true,
      hasAudio: false,
      ...probe,
    }),
  } as never);
}

beforeEach(() => {
  dir = "";
  withProbe({ duration: 4 * S, width: 1920, height: 1080, frameRate: 30 });
});

describe("importedManifest", () => {
  it("describes the file as a screen track and nothing else", () => {
    const manifest = importedManifest(
      { duration: 4 * S, width: 1920, height: 1080, frameRate: 30, hasAudio: false },
      { name: "Demo.mov" },
    );

    expect(manifest.tracks.map((track) => track.kind)).toEqual(["screen"]);
    expect(manifest.duration).toBe(4 * S);
    // Marked as an import, which is what tells the transcription its sound is
    // somebody talking rather than whatever was playing.
    expect(manifest.takes).toEqual([{ dir: "", start: 0, end: 4 * S, imported: true }]);
    // No camera, no microphone, no pointer, no presses: an imported clip is a
    // screen recording with nothing else in it.
    expect(manifest.cursor ?? []).toEqual([]);
    expect(manifest.clicks ?? []).toEqual([]);
    expect(manifest.key_presses ?? []).toEqual([]);
  });

  it("gives the sound its own track, pointing at the same file", () => {
    const manifest = importedManifest({ duration: 4 * S, hasAudio: true }, { name: "Demo.mov" });

    const screen = manifest.tracks.find((track) => track.kind === "screen");
    const system = manifest.tracks.find((track) => track.kind === "system_audio");

    // The sound is inside the video, and both readers take the first track of
    // the type they want — so the two segments name one file.
    expect(system?.segments[0]!.file_name).toBe(screen?.segments[0]!.file_name);
    expect(system?.segments[0]!.end).toBe(4 * S);
  });

  it("claims no sound track for a file with no sound in it", () => {
    // The failure this exists for is an export, not an editor: `AudioReader`
    // refuses a file with no audio track, minutes into a render.
    const manifest = importedManifest({ duration: 4 * S, hasAudio: false }, { name: "Demo.mov" });

    expect(manifest.tracks.some((track) => track.kind === "system_audio")).toBe(false);
  });

  it("takes the recording's pointer off the screen at the seam", () => {
    const manifest = importedManifest(
      { duration: 4 * S, hasAudio: false },
      { name: "Demo.mov", from: { x: 0.4, y: 0.6 } },
    );

    // Held where it was for an instant, then off the frame — a sample outside
    // the frame is drawn as a pointer that has left.
    expect(manifest.cursor).toEqual([
      { at: 0, x: 0.4, y: 0.6 },
      { at: 1, x: -1, y: -1 },
    ]);
  });
});

describe("importVideo", () => {
  it("appends the file to the recording as a take of its own", async () => {
    dir = recording(10 * S);
    // Saved first, so the recording has been edited. Without a `project.json`
    // the merge's own `loadProject` builds a fresh one that already has a clip
    // per take, and appending a second over the same footage would show the
    // addition twice — which is the case the next assertion would miss.
    saveProject(dir, loadProject(dir, "recording-id", 10 * S));
    flushProject(dir);

    const merged = await importVideo(dir, sourceFile());
    expect(merged?.at).toBe(10 * S);

    const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
    expect(manifest.duration).toBe(14 * S);
    expect(manifest.takes).toHaveLength(2);
    // The recording it was added to is still the same recording: the id is what
    // `project.json` and the transcript check themselves against.
    expect(manifest.id).toBe("recording-id");

    const segments = manifest.tracks.find((track) => track.kind === "screen")!.segments;
    expect(segments[1]!.file_name).toBe("2/screen.mp4");
    expect(segments[1]!.start).toBe(10 * S);

    flushProject(dir);
    const project = JSON.parse(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")) as {
      tracks: { slices: { source: { start: number; end: number } }[] }[];
    };
    const slices = project.tracks[0]!.slices;
    expect(slices.at(-1)!.source).toEqual({ start: 10 * S, end: 14 * S });
  });

  it("leaves the recording alone when the file holds no video", async () => {
    dir = recording(10 * S);
    withProbe({ duration: 4 * S, hasVideo: false });

    const before = readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8");

    expect(await importVideo(dir, sourceFile("Sound.m4v"))).toBeNull();
    // Byte-identical, and no numbered directory left behind for the recovery
    // pass on every later open to walk past.
    expect(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8")).toBe(before);
    expect(parseManifest(before).takes).toHaveLength(1);
    expect(existsSync(join(dir, "2"))).toBe(false);
  });

  it("hides the pointer of a recording that has one", async () => {
    dir = recording(10 * S, {
      cursor_baked: false,
      cursor: [
        { at: 0, x: 0.1, y: 0.1 },
        { at: 9 * S, x: 0.5, y: 0.5 },
      ],
    });

    await importVideo(dir, sourceFile());

    const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
    // Held at the seam where the recording's own last sample left it, and off
    // the frame a nanosecond later — so nothing is drawn over the imported clip
    // and nothing disappears from the footage before it.
    expect(manifest.cursor?.slice(-2)).toEqual([
      { at: 10 * S, x: 0.5, y: 0.5 },
      { at: 10 * S + 1, x: -1, y: -1 },
    ]);
  });

  it("marks the take it added as an import", async () => {
    dir = recording(10 * S);

    await importVideo(dir, sourceFile());

    const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
    // On the merged table, not only in the take's own manifest: the merge is
    // what the rest of the app reads, and this is what `speechSegments` needs.
    expect(manifest.takes[0]!.imported).toBeUndefined();
    expect(manifest.takes[1]!.imported).toBe(true);
  });

  it("offers the imported clip's sound to the transcription", async () => {
    dir = recording(10 * S);
    withProbe({ duration: 4 * S, hasAudio: true });

    await importVideo(dir, sourceFile());

    const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
    // The imported file itself, on the session clock: the sound is inside the
    // video, and `AVAudioFile` reads it out of an MP4 with a picture in it.
    expect(speechSegments(manifest).map((segment) => segment.file_name)).toEqual(["2/screen.mp4"]);
    expect(untranscribed(manifest, null)).toHaveLength(1);
  });

  it("adds nothing to the pointer of a recording that baked one in", async () => {
    dir = recording(10 * S);

    await importVideo(dir, sourceFile());

    const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
    expect(manifest.cursor ?? []).toEqual([]);
  });
});
