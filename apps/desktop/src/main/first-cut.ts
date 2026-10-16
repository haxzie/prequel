/**
 * The first cut, from main: a recording's project with its zooms made.
 *
 * The pass itself is `shared/autoedit.ts`. This is the two file reads around
 * it, and it lives here rather than in `cli/commands.ts` — where it started —
 * because the quick view needs the same thing for the same reason: a capture
 * exported without the editor ever opening would come out flat, and the zooms
 * are the whole claim of the app.
 *
 * Written to `project.json` rather than left in memory, so the editor agrees
 * with the file that was rendered. The pass is guarded on a project having no
 * zooms of its own, so it runs once; deleting them all leaves them deleted and
 * the app does not argue.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { autoZooms, momentsOf } from "../shared/autoedit.js";
import type { Manifest } from "../shared/manifest.js";
import {
  MANIFEST_FILE_NAME,
  findTrack,
  isStill,
  parseManifest,
  seamsOf,
} from "../shared/manifest.js";
import { sourceShape, type Project } from "../shared/project.js";
import { loadProject, saveProject } from "./editor-project.js";
import { log } from "./log.js";

export function readManifest(dir: string): Manifest {
  return parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
}

/**
 * A recording's project, loaded the way the editor loads it.
 *
 * Through `loadProject` rather than by reading the file, because a recording
 * nobody has edited has no `project.json` at all and the answer then is the
 * defaults the editor would have shown — not an error.
 */
export function projectOf(dir: string): Project {
  const manifest = readManifest(dir);
  const screenTrack = findTrack(manifest, "screen")?.segments?.[0];
  return loadProject(
    dir,
    manifest.id,
    manifest.duration,
    sourceShape(
      manifest.source,
      screenTrack && { width: screenTrack.width ?? null, height: screenTrack.height ?? null },
      isStill(manifest),
    ),
    seamsOf(manifest),
  );
}

/** Makes the first cut on a recording nothing has opened an editor on. */
export function firstCut(dir: string): Project {
  const manifest = readManifest(dir);
  const project = projectOf(dir);

  if (project.zooms.length > 0) return project;

  const moments = momentsOf(manifest);
  if (moments.length === 0) return project;

  const zooms = autoZooms(moments, {
    duration: manifest.duration,
    // Without a pointer track a `cursor` zoom has nothing to follow, and the
    // pass makes fixed regions instead. The same question the editor asks.
    hasCursor: (manifest.cursor?.length ?? 0) > 0 && manifest.cursor_baked !== true,
  });
  if (zooms.length === 0) return project;

  const cut = { ...project, zooms };
  saveProject(dir, cut);
  log("info", `first cut: ${String(zooms.length)} zooms`, dir);
  return cut;
}
