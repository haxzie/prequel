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
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Ns, Project, SourceShape } from "../shared/project.js";
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
  /** What was recorded — see `newProject`. Only consulted when there is no
      project file yet. */
  source?: SourceShape,
  /**
   * Source times the recording was extended at — `seamsOf(manifest)`.
   *
   * Consulted whether or not there is a project file: a slice may never span a
   * seam, so a project saved before the recording was extended has to be cut at
   * the new one on the way in. See `cutAtSeams`.
   */
  seams: readonly Ns[] = [],
): Project {
  const held = pending.get(dir);
  if (held) return held;

  let raw: string;
  try {
    raw = readFileSync(pathFor(dir), "utf8");
  } catch {
    // Never edited. Not written yet either — an untouched recording folder
    // stays as the recorder left it.
    return newProject(recordingId, duration, source, seams);
  }

  try {
    return (
      sanitiseProject(JSON.parse(raw), recordingId, duration, seams) ??
      newProject(recordingId, duration, source, seams)
    );
  } catch (cause) {
    console.warn(`[editor] ignoring unreadable ${PROJECT_FILE_NAME} in ${dir}:`, cause);
    return newProject(recordingId, duration, source, seams);
  }
}

/**
 * Records the latest project and writes it.
 *
 * Held as well as written so that a close arriving between two debounced saves
 * still has something to flush.
 */
export function saveProject(dir: string, project: Project): void {
  if (gone(dir)) return;
  pending.set(dir, project);
  write(dir, project);
}

/** Writes anything still held for a directory, then forgets it. */
export function flushProject(dir: string): void {
  const project = pending.get(dir);
  if (!project) return;
  if (!gone(dir)) write(dir, project);
  pending.delete(dir);
}

/**
 * Drops what is held for a directory without writing it.
 *
 * For a recording on its way to the Trash. The check below already keeps the
 * held edit from being written into a folder that has gone, so this is about
 * the one case that defeats it: the folder coming back. A recording put back
 * from the Trash is the recording as it was when it went in, and an edit made
 * after that — still sitting in `pending`, waiting for a flush that may be
 * minutes away — must not be stamped over the top of it.
 */
export function forgetProject(dir: string): void {
  pending.delete(dir);
}

/**
 * Whether a recording's directory has gone from under us.
 *
 * Deleting the recording you are editing reaches this twice, and used to write
 * two `ENOENT` failures with stacks into the log every time: `projectsDelete`
 * trashes the folder and then returns the window to the grid, which flushes the
 * project it was showing, and the renderer's own debounced save lands a few
 * milliseconds after that. Neither was a real failure — the file was meant to
 * be gone — but both read as "could not save your edit" in the one file a user
 * sends us when something goes wrong.
 *
 * A check before the write rather than a quieter `catch` around it: a write
 * that fails for any other reason is still worth the warning it prints.
 */
function gone(dir: string): boolean {
  return !existsSync(dir);
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
