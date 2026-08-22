/**
 * Moving a pre-existing library into the layout `session.ts` now describes.
 *
 * Recordings used to sit directly in `~/Movies/Prequel`, each holding its own
 * exports alongside the tracks, both manifests, four pointer images and one
 * JPEG per background that had ever been previewed. They now live in
 * `.recordings/`, and exports sit at the top on their own.
 *
 * Renames only — never a copy and never a delete. Every step is `rename`, which
 * is atomic within a volume, so an interruption leaves each take either where
 * it was or where it is going and never half of both. Nothing here removes
 * anything: a take that cannot be moved is left exactly as it is and reported,
 * because the alternative is losing footage to a tidy-up.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { MANIFEST_FILE_NAME } from "../shared/manifest.js";
import { log } from "./log.js";
import { RECORDINGS_DIR, SESSIONS_DIR } from "./session.js";

/** Exports were written as `Export <timestamp>.<ext>` inside the take. */
const EXPORT = /^Export .*\.(mp4|gif)$/i;

export interface Migration {
  recordings: number;
  exports: number;
  failed: number;
}

/**
 * Runs once at startup. Cheap and idempotent when there is nothing to do — the
 * common case is a `readdir` that finds no loose take and returns.
 */
export function migrateLibrary(): Migration {
  const result: Migration = { recordings: 0, exports: 0, failed: 0 };
  if (!existsSync(RECORDINGS_DIR)) return result;

  let entries: string[];
  try {
    entries = readdirSync(RECORDINGS_DIR);
  } catch (cause) {
    console.warn(`[library] could not read ${RECORDINGS_DIR}:`, cause);
    return result;
  }

  for (const name of entries) {
    // `.recordings` itself, and anything else already hidden.
    if (name.startsWith(".")) continue;

    const from = join(RECORDINGS_DIR, name);
    // A take is a directory with a manifest in it. A loose file at this level
    // is either an export somebody already moved or something that was never
    // ours, and both are left alone.
    if (!isRecording(from)) continue;

    try {
      result.exports += liftExports(from);
      mkdirSync(SESSIONS_DIR, { recursive: true });

      const to = join(SESSIONS_DIR, name);
      // Refusing rather than overwriting. A name collision here means two takes
      // claim the same timestamp, and picking a winner silently is how one of
      // them stops existing.
      if (existsSync(to)) {
        console.warn(`[library] not moving ${name}: something is already at ${to}`);
        result.failed += 1;
        continue;
      }

      renameSync(from, to);
      result.recordings += 1;
    } catch (cause) {
      console.warn(`[library] could not move ${name}:`, cause);
      result.failed += 1;
    }
  }

  if (result.recordings || result.exports || result.failed) {
    log("info", "library migrated", result);
  }

  return result;
}

/** Whether this is a take rather than a stray file. */
function isRecording(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, MANIFEST_FILE_NAME));
  } catch {
    return false;
  }
}

/**
 * Moves a take's finished exports up beside the library.
 *
 * Done before the take itself moves, so an interruption leaves the exports
 * either inside a take that is still where it was, or beside a take that has
 * not moved yet — both states the next run handles.
 *
 * A name already taken at the top is left where it is rather than renamed
 * around: these carry a timestamp to the second, so a collision means the same
 * export, and moving it twice is not worth inventing a `(2)` for.
 */
function liftExports(from: string): number {
  let moved = 0;

  for (const file of readdirSync(from)) {
    if (!EXPORT.test(file)) continue;

    const target = join(RECORDINGS_DIR, file);
    if (existsSync(target)) continue;

    try {
      renameSync(join(from, file), target);
      moved += 1;
    } catch (cause) {
      console.warn(`[library] could not lift ${file}:`, cause);
    }
  }

  return moved;
}
