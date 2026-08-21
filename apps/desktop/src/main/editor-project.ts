/**
 * `project.json`, beside the recording it edits.
 *
 * Kept in the session directory rather than in app support, so a recording is
 * one self-contained folder: move it to another machine and the cuts, the
 * background and the audio mix move with it.
 *
 * Written atomically, and held in memory until then. An editor is closed by
 * closing its window, which does not wait for a promise — so the last edit is
 * flushed synchronously on the way out rather than being raced by teardown.
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Ns, Project } from "../shared/project.js";
import { newProject, PROJECT_FILE_NAME, sanitiseProject } from "../shared/project.js";

/** Projects received but not yet on disk, keyed by session directory. */
const pending = new Map<string, Project>();

function pathFor(dir: string): string {
  return join(dir, PROJECT_FILE_NAME);
}

/**
 * Loads a recording's project, or makes a fresh one.
 *
 * Never throws for a missing, corrupt or incompatible file: the recording is
 * the irreplaceable part, and refusing to open an editor over a bad sidecar
 * would strand it. A file that cannot be used is replaced by defaults, which
 * the next save then overwrites.
 */
export function loadProject(
  dir: string,
  recordingId: string,
  duration: Ns,
  /** Whether the recording is of a whole screen — see `newProject`. Only
      consulted when there is no project file yet. */
  fullScreen = false,
): Project {
  const held = pending.get(dir);
  if (held) return held;

  let raw: string;
  try {
    raw = readFileSync(pathFor(dir), "utf8");
  } catch {
    // Never edited. Not written yet either — an untouched recording folder
    // stays as the recorder left it.
    return newProject(recordingId, duration, fullScreen);
  }

  try {
    return (
      sanitiseProject(JSON.parse(raw), recordingId, duration) ??
      newProject(recordingId, duration, fullScreen)
    );
  } catch (cause) {
    console.warn(`[editor] ignoring unreadable ${PROJECT_FILE_NAME} in ${dir}:`, cause);
    return newProject(recordingId, duration, fullScreen);
  }
}

/**
 * Records the latest project and writes it.
 *
 * Held as well as written so that a close arriving between two debounced saves
 * still has something to flush.
 */
export function saveProject(dir: string, project: Project): void {
  pending.set(dir, project);
  write(dir, project);
}

/** Writes anything still held for a directory, then forgets it. */
export function flushProject(dir: string): void {
  const project = pending.get(dir);
  if (!project) return;
  write(dir, project);
  pending.delete(dir);
}

/**
 * Writes through a temporary file.
 *
 * A crash partway through a direct write leaves a truncated `project.json`,
 * which is a lost edit rather than a corrupt one only because `loadProject`
 * falls back — this keeps it from happening at all.
 */
function write(dir: string, project: Project): void {
  const path = pathFor(dir);
  const temporary = `${path}.tmp`;

  try {
    writeFileSync(temporary, JSON.stringify(project, null, 2));
    renameSync(temporary, path);
  } catch (cause) {
    console.warn(`[editor] could not save ${path}:`, cause);
    try {
      unlinkSync(temporary);
    } catch {
      // Nothing to clean up.
    }
  }
}
