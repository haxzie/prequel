/**
 * What opening a recording is allowed to wait for.
 *
 * The editor is drawn from `readEditorSession`, so anything awaited inside it is
 * time the window spends showing "Opening …" with not one control on screen. Both
 * of the slow pieces — a pass over every media file, and putting the background's
 * picture beside the recording, which can be a screenshot of the desktop or a
 * download — belong to `readSessionDetails` and are asked for afterwards.
 *
 * Fails silently if it regresses: an `await` put back on the open path produces a
 * perfectly correct session, just later, and nothing in the log says so.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MANIFEST_FILE_NAME, MANIFEST_VERSION } from "../shared/manifest.js";

vi.mock("electron", () => ({
  shell: { openPath: async () => "", showItemInFolder: () => undefined, trashItem: async () => {} },
  dialog: { showMessageBox: async () => ({ response: 1 }) },
  app: { getPath: () => tmpdir() },
}));

/** Every probe this suite hands out, and whether one was ever asked for. */
const probed: string[] = [];

vi.mock("./recorder.js", () => ({
  getRecorder: async () => ({
    probeSession: (dir: string) => {
      probed.push(dir);
      return Promise.resolve([
        { kind: "screen", duration: 9 * SECOND, width: 1920, height: 1080, frameRate: 60 },
      ]);
    },
    soundCues: () => ({ sampleRate: 48_000, at: new Float64Array(), voice: new Uint32Array() }),
  }),
}));

/**
 * Recordings the default background's picture was put into.
 *
 * A fresh project opens on a shipped picture, so this is the branch under test;
 * `ensureBackground` is mocked out beside it so nothing here reaches the network,
 * and `ensureWallpaper` so nothing screenshots the desktop of whoever is running
 * the suite.
 */
const provided: string[] = [];

/** Set to make every way of providing the picture fail. */
let unprovidable = false;

vi.mock("./wallpaper.js", () => ({
  copyPresetBackground: (dir: string) => {
    if (unprovidable) return null;
    provided.push(dir);
    return { kind: "image", source: "preset", path: "background.jpg" };
  },
  ensureWallpaper: () => Promise.resolve(false),
}));

vi.mock("./backgrounds.js", () => ({ ensureBackground: () => Promise.resolve(false) }));

const { readEditorSession, readSessionDetails } = await import("./editor-session.js");

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-session-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const SECOND = 1_000_000_000;

beforeEach(() => {
  probed.length = 0;
  provided.length = 0;
  unprovidable = false;
});

/** A recording the recorder left behind, with no project beside it. */
function recording(name: string): string {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, MANIFEST_FILE_NAME),
    JSON.stringify({
      version: MANIFEST_VERSION,
      id: name,
      started_at: new Date().toISOString(),
      duration: 10 * SECOND,
      source: { kind: "display", id: 1, title: "Screen", scale_factor: 2 },
      takes: [{ start: 0, end: 10 * SECOND }],
      tracks: [
        {
          kind: "screen",
          segments: [
            {
              file_name: "screen.mp4",
              start: 0,
              end: 10 * SECOND,
              samples: 600,
              dropped: 0,
              width: 2560,
              height: 1440,
            },
          ],
        },
      ],
    }),
  );

  return dir;
}

describe("readEditorSession", () => {
  it("opens a recording without probing it", async () => {
    const session = await readEditorSession(recording("fast"));

    expect(probed).toEqual([]);
    // The manifest's own numbers, which is the same answer a failed probe has
    // always left the editor on.
    expect(session.media).toHaveLength(1);
    expect(session.media[0]?.duration).toBe(10 * SECOND);
    expect(session.media[0]?.width).toBe(2560);
  });

  it("opens a recording without providing its background", async () => {
    const session = await readEditorSession(recording("no-background"));

    expect(provided).toEqual([]);
    // The default is left naming its picture, and the editor is told nothing is
    // missing — the question has not been asked yet.
    expect(session.project.defaults.background.background.kind).toBe("image");
    expect(session.backgroundMissing).toBe(false);
  });
});

describe("readSessionDetails", () => {
  it("prefers each file's own account of itself", async () => {
    const dir = recording("probed");
    const details = await readSessionDetails(dir);

    expect(probed).toEqual([dir]);
    expect(details.dir).toBe(dir);
    expect(details.media[0]?.duration).toBe(9 * SECOND);
    expect(details.media[0]?.width).toBe(1920);
    // Never the probe's: a track's late start lives only in the manifest, and
    // every session file is written zero-based.
    expect(details.media[0]?.offset).toBe(0);
  });

  it("provides the background and says it is there", async () => {
    const dir = recording("backgrounded");

    expect(await readSessionDetails(dir)).toMatchObject({ backgroundMissing: false });
    expect(provided).toEqual([dir]);
  });

  it("says so when the background could not be provided", async () => {
    const dir = recording("backgroundless");
    unprovidable = true;

    expect(await readSessionDetails(dir)).toMatchObject({ backgroundMissing: true });
  });
});
