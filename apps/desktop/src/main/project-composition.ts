/**
 * The library's tile, for one recording, read off disk.
 *
 * The arithmetic — which frame, out of which file — is in
 * `shared/composition.ts`, so the gallery can answer the same question without
 * `electron`. This is the two file reads and the background repair around it.
 *
 * Assembled here rather than by asking for an `EditorSession`, for two reasons.
 * That channel calls `workspace.enterRecording` — the library would claim to be
 * editing a dozen recordings to draw a dozen tiles — and the session carries the
 * cursor samples, the transcript and the sound plan, none of which a still
 * needs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { composition } from "../shared/composition.js";
import type { ProjectComposition } from "../shared/contract.js";
import type { Manifest, Segment } from "../shared/manifest.js";
import {
  MANIFEST_FILE_NAME,
  findTrack,
  isStill,
  parseManifest,
  seamsOf,
} from "../shared/manifest.js";
import { sourceShape } from "../shared/project.js";
import { loadProject } from "./editor-project.js";
import { withBackground } from "./editor-session.js";
import { mediaUrl } from "./media-protocol.js";
import { insideRecordings, SESSIONS_DIR } from "./session.js";

/**
 * Everything the grid needs to draw this recording as its edit looks, or null
 * when the directory holds no recording this build can read.
 */
export async function readComposition(
  dir: string,
  root = SESSIONS_DIR,
): Promise<ProjectComposition | null> {
  if (!insideRecordings(dir, root)) {
    console.warn(`[library] refusing to read a composition outside the recordings folder: ${dir}`);
    return null;
  }

  let manifest: Manifest;
  try {
    manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
  } catch (cause) {
    // No manifest, or one this build cannot read. The tile keeps its
    // placeholder; there is nothing here to draw.
    console.warn(`[library] could not read the manifest for ${dir}:`, cause);
    return null;
  }

  // The same repair the editor makes on the way in: a project whose background
  // is a catalogue picture this Mac has never held names a file that is not
  // there, and the tile would draw the gap rather than the picture.
  const project = await withBackground(
    dir,
    loadProject(
      dir,
      manifest.id,
      manifest.duration,
      sourceShape(
        manifest.source,
        firstSegment(findTrack(manifest, "screen")?.segments),
        isStill(manifest),
      ),
      seamsOf(manifest),
    ),
  );

  return composition(manifest, project, (file) => mediaUrl(dir, file));
}

/** The first segment's dimensions, in the shape `sourceShape` reads them. */
function firstSegment(
  segments: readonly Segment[] | undefined,
): { width: number | null; height: number | null } | undefined {
  const segment = segments?.[0];
  return segment && { width: segment.width ?? null, height: segment.height ?? null };
}
