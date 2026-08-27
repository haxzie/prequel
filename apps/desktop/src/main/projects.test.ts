/**
 * What the Projects grid is allowed to offer, and what a rename does.
 *
 * Two properties matter here and both fail quietly. An interrupted take leaves
 * a directory with a half-written screen track and nothing describing it —
 * listing that produces a tile that only ever fails on click. And a rename must
 * never move the folder: `prequel-media://` URLs are built from its basename,
 * so a directory that moved is a grid of broken thumbnails.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { MANIFEST_FILE_NAME, MANIFEST_VERSION } from "../shared/manifest.js";
import { PROJECT_FILE_NAME } from "../shared/project.js";

vi.mock("electron", () => ({
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
  app: { getPath: () => tmpdir() },
}));

const { listProjects, renameProject, savePoster, POSTER_FILE_NAME } = await import("./projects.js");

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-projects-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A recording directory, with its manifest stamped at `secondsAgo`. */
function recording(name: string, secondsAgo = 0): string {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });

  const manifest = join(dir, MANIFEST_FILE_NAME);
  writeFileSync(
    manifest,
    JSON.stringify({
      version: MANIFEST_VERSION,
      id: name,
      started_at: new Date().toISOString(),
      duration: 5_000_000_000,
      source: { kind: "display", id: 1, title: "Screen", scale_factor: 2 },
      tracks: [],
    }),
  );

  const at = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(manifest, at, at);
  return dir;
}

/** The one entry for a directory, whatever else is in the scratch folder. */
function entry(dir: string) {
  return listProjects(SCRATCH).find((project) => project.dir === dir);
}

describe("listProjects", () => {
  it("lists recordings newest first", () => {
    const older = recording("older", 60);
    const newer = recording("newer", 10);

    const listed = listProjects(SCRATCH).map((project) => project.dir);
    expect(listed.indexOf(newer)).toBeLessThan(listed.indexOf(older));
  });

  it("skips a directory with no manifest", () => {
    // An interrupted take. There is nothing to open.
    mkdirSync(join(SCRATCH, "interrupted"), { recursive: true });

    expect(listProjects(SCRATCH).map((project) => project.name)).not.toContain("interrupted");
  });

  it("returns nothing when the recordings folder does not exist yet", () => {
    // Before the first recording. The grid is empty rather than broken.
    expect(listProjects(join(SCRATCH, "never-created"))).toEqual([]);
  });

  it("names a recording after its folder until it is renamed", () => {
    const dir = recording("unnamed");

    expect(entry(dir)?.name).toBe("unnamed");
  });

  it("has no poster until one is cached", () => {
    const dir = recording("unposted");

    expect(entry(dir)?.poster).toBeNull();
  });

  it("points at the cached poster once there is one", () => {
    const dir = recording("posted");
    writeFileSync(join(dir, POSTER_FILE_NAME), "");

    // The directory's *name*, never its path: the handler resolves it against
    // the recordings folder and refuses anything landing outside.
    expect(entry(dir)?.poster).toBe(`prequel-media://recording/posted/${POSTER_FILE_NAME}`);
  });
});

describe("renameProject", () => {
  it("shows the new name without moving the folder", () => {
    const dir = recording("renamed-take");
    renameProject(dir, "Onboarding walkthrough", SCRATCH);

    expect(entry(dir)?.name).toBe("Onboarding walkthrough");
    // The property the whole design rests on: every media URL is built from
    // this basename, so a folder that moved is a tile with no picture.
    expect(existsSync(dir)).toBe(true);
  });

  it("writes a project for a recording nobody has edited", () => {
    const dir = recording("never-edited");
    expect(existsSync(join(dir, PROJECT_FILE_NAME))).toBe(false);

    renameProject(dir, "First take", SCRATCH);

    const stored = JSON.parse(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")) as {
      name: string;
      recordingId: string;
    };
    expect(stored.name).toBe("First take");
    expect(stored.recordingId).toBe("never-edited");
  });

  it("declines a blank name", () => {
    const dir = recording("keeps-its-name");
    renameProject(dir, "   ", SCRATCH);

    // A card with no label has nothing left to click into and fix.
    expect(entry(dir)?.name).toBe("keeps-its-name");
  });

  it("refuses a directory outside the recordings folder", () => {
    const outside = mkdtempSync(join(tmpdir(), "prequel-outside-"));
    renameProject(outside, "Somewhere else", SCRATCH);

    expect(existsSync(join(outside, PROJECT_FILE_NAME))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("savePoster", () => {
  it("refuses anything that is not a JPEG data URL", () => {
    // Whatever `Buffer.from` made of it would be written to disk and served
    // back to a renderer as an image.
    const dir = recording("not-a-poster");
    savePoster(dir, "https://example.com/evil.jpg", SCRATCH);

    expect(existsSync(join(dir, POSTER_FILE_NAME))).toBe(false);
  });

  it("refuses a directory outside the recordings folder", () => {
    const outside = mkdtempSync(join(tmpdir(), "prequel-outside-"));
    savePoster(
      outside,
      `data:image/jpeg;base64,${Buffer.from("nope").toString("base64")}`,
      SCRATCH,
    );

    expect(existsSync(join(outside, POSTER_FILE_NAME))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });
});
