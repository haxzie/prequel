/**
 * One recording, read off disk for the library's inspector.
 *
 * Beside `project-composition.ts` and for its reasons: the grid's tile and the
 * inspector's facts are both "open this recording's two files without claiming
 * to edit it", and neither may go through the editor-session channel — that one
 * calls `workspace.enterRecording`, which would have the library claiming to be
 * editing whatever a pointer happened to rest on.
 *
 * Everything here is a syscall a renderer cannot make. The directory's size is
 * the only one that is not free, and it is a single shallow walk: a recording
 * is a folder of files with one `bitmaps` folder in it, not a tree.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ProjectDetails } from "../shared/contract.js";
import { MANIFEST_FILE_NAME, findTrack, isStill, parseManifest } from "../shared/manifest.js";
import { PROJECT_FILE_NAME } from "../shared/project.js";
import { insideRecordings, SESSIONS_DIR } from "./session.js";

/**
 * What the inspector reads out, or null for a directory holding no recording
 * this build can read.
 *
 * Null rather than a throw, like `readComposition`: a pane with no facts in it
 * is a pane, and one that threw is a library that stopped drawing.
 */
export function readDetails(dir: string, root = SESSIONS_DIR): ProjectDetails | null {
  if (!insideRecordings(dir, root)) {
    console.warn(`[library] refusing to read details outside the recordings folder: ${dir}`);
    return null;
  }

  let manifestAt: number;
  let manifest;
  try {
    const path = join(dir, MANIFEST_FILE_NAME);
    manifestAt = statSync(path).mtimeMs;
    manifest = parseManifest(readFileSync(path, "utf8"));
  } catch (cause) {
    console.warn(`[library] could not read the manifest for ${dir}:`, cause);
    return null;
  }

  const screen = findTrack(manifest, "screen")?.segments[0];

  return {
    dir,
    folder: abbreviate(dir),
    // The manifest's mtime, which is when the take *finished* — `session.json`
    // is written once, at the end. The same answer the grid's own `createdAt`
    // gives, and deliberately: two numbers for "when was this made" differing
    // by the length of the recording is the sort of thing nobody reports and
    // everybody notices.
    createdAt: manifestAt,
    editedAt: mtime(join(dir, PROJECT_FILE_NAME)),
    bytes: weigh(dir),
    durationMs: Math.round(manifest.duration / 1e6),
    source:
      screen?.width !== undefined && screen.height !== undefined
        ? { width: screen.width, height: screen.height }
        : null,
    still: isStill(manifest),
    clips: manifest.takes.length,
  };
}

/** A file's mtime, or null when it is not there — which is every take nobody
    has opened in the editor. */
function mtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Every byte under a directory.
 *
 * Recursive, because a recording keeps its rasterised captions and texts in a
 * `bitmaps` folder and on a long take those are most of what is not video.
 * Symlinks are not followed — `lstat`'s size is the link's own, which is what
 * the disk actually holds — and anything that cannot be read is counted as
 * nothing rather than throwing: this is a reading, and a reading that failed
 * because one file was busy is worse than one that is a few kilobytes short.
 */
function weigh(dir: string): number {
  let total = 0;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return total;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += weigh(path);
      continue;
    }
    try {
      total += statSync(path).size;
    } catch {
      // Gone between the listing and the stat, or unreadable. Worth nothing.
    }
  }

  return total;
}

/**
 * A folder as a Mac writes one: `~/Movies/Prequel`, not `/Users/you/Movies/…`.
 *
 * `exports.ts` abbreviates the same way for the same reason — the home
 * directory is half the width and the same every time, so spelling it out
 * pushes the part that differs out of view.
 */
function abbreviate(folder: string): string {
  const home = homedir();
  return folder === home
    ? "~"
    : folder.startsWith(`${home}/`)
      ? `~${folder.slice(home.length)}`
      : folder;
}
