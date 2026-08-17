/**
 * The sidecar must never cost someone a recording.
 *
 * A `project.json` that is missing, truncated or from another build is a lost
 * edit. Refusing to open the editor over one would strand the take itself,
 * which is the part that cannot be remade — so every failure here falls back to
 * defaults rather than throwing.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { newProject, PROJECT_FILE_NAME, PROJECT_VERSION } from "../shared/project.js";
import { flushProject, loadProject, saveProject } from "./editor-project.js";

const S = 1_000_000_000;
const RECORDING = "2026-08-11T12-00-00";

const ROOT = mkdtempSync(join(tmpdir(), "prequel-project-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

let dir = "";
let counter = 0;

beforeEach(() => {
  dir = join(ROOT, `take-${(counter += 1)}`);
  mkdirSync(dir, { recursive: true });
});

const stored = () => JSON.parse(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")) as unknown;

describe("loadProject", () => {
  it("makes a fresh project when nothing has been saved", () => {
    const project = loadProject(dir, RECORDING, 10 * S);

    expect(project.recordingId).toBe(RECORDING);
    expect(project.tracks[0]!.slices[0]!.source).toEqual({ start: 0, end: 10 * S });
  });

  it("writes nothing for a recording nobody has edited", () => {
    // An untouched recording folder stays exactly as the recorder left it.
    loadProject(dir, RECORDING, 10 * S);
    expect(() => readFileSync(join(dir, PROJECT_FILE_NAME))).toThrow();
  });

  it("reads back a saved project", () => {
    const project = newProject(RECORDING, 10 * S);
    project.frame = { width: 1080, height: 1920, presetId: "9:16" };
    saveProject(dir, project);
    flushProject(dir);

    expect(loadProject(dir, RECORDING, 10 * S).frame).toEqual({
      width: 1080,
      height: 1920,
      presetId: "9:16",
    });
  });

  it("falls back to defaults for a truncated file", () => {
    writeFileSync(join(dir, PROJECT_FILE_NAME), '{"version": 1, "trac');

    const project = loadProject(dir, RECORDING, 10 * S);

    expect(project.recordingId).toBe(RECORDING);
    expect(project.tracks[0]!.slices).toHaveLength(1);
  });

  it("falls back to defaults for a project from a newer build", () => {
    const future = { ...newProject(RECORDING, 10 * S), version: PROJECT_VERSION + 1 };
    writeFileSync(join(dir, PROJECT_FILE_NAME), JSON.stringify(future));

    expect(loadProject(dir, RECORDING, 10 * S).version).toBe(PROJECT_VERSION);
  });

  it("falls back to defaults for a project belonging to another recording", () => {
    saveProject(dir, newProject("some-other-take", 10 * S));
    flushProject(dir);

    const project = loadProject(dir, RECORDING, 10 * S);

    expect(project.recordingId).toBe(RECORDING);
  });
});

describe("saveProject", () => {
  it("writes the project as readable JSON", () => {
    saveProject(dir, newProject(RECORDING, 10 * S));

    expect(stored()).toMatchObject({ version: PROJECT_VERSION, recordingId: RECORDING });
  });

  it("leaves no temporary file behind", () => {
    // Written through a temp file and renamed, so a crash partway cannot leave
    // a half-written project where a whole one used to be.
    saveProject(dir, newProject(RECORDING, 10 * S));

    expect(() => readFileSync(join(dir, `${PROJECT_FILE_NAME}.tmp`))).toThrow();
  });

  it("serves the newest project to a reopen before the write settles", () => {
    // Held in memory as well as written: reopening a recording must not read a
    // version older than the edit that was just made.
    const project = newProject(RECORDING, 10 * S);
    project.output = { fps: 30, format: "hevc", shortEdge: 720 };
    saveProject(dir, project);

    expect(loadProject(dir, RECORDING, 10 * S).output).toEqual({
      fps: 30,
      format: "hevc",
      shortEdge: 720,
    });
  });

  it("overwrites a previous save rather than appending", () => {
    saveProject(dir, newProject(RECORDING, 10 * S));

    const second = newProject(RECORDING, 10 * S);
    second.frame = { width: 1080, height: 1080, presetId: "1:1" };
    saveProject(dir, second);
    flushProject(dir);

    expect(loadProject(dir, RECORDING, 10 * S).frame.presetId).toBe("1:1");
  });
});

describe("flushProject", () => {
  it("is safe to call for a directory with nothing pending", () => {
    expect(() => flushProject(dir)).not.toThrow();
  });

  it("leaves the file readable afterwards", () => {
    saveProject(dir, newProject(RECORDING, 10 * S));
    flushProject(dir);

    expect(stored()).toMatchObject({ recordingId: RECORDING });
  });
});
