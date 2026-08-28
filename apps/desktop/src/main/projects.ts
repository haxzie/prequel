/**
 * The local library: every recording on this Mac, as the Projects grid lists it.
 *
 * Reads directories rather than parsing them. A take's manifest carries a
 * cursor sample every few frames — tens of thousands of them for a long
 * recording — and `JSON.parse` over every manifest in the folder to draw a grid
 * of tiles costs far more than the two fields the grid actually needs. So the
 * timestamp comes from the manifest's mtime and the name from the much smaller
 * `project.json`, and `session.json` is only ever stat'd.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { ProjectSummary } from "../shared/contract.js";
import { MANIFEST_FILE_NAME, parseManifest } from "../shared/manifest.js";
import { mediaUrl } from "../shared/media-url.js";
import { PROJECT_FILE_NAME } from "../shared/project.js";
import { loadProject, saveProject } from "./editor-project.js";
import { insideRecordings, SESSIONS_DIR } from "./session.js";

/**
 * The cached still, beside the recording it is of.
 *
 * `.jpg` because `ALLOWED` in `media-protocol.ts` already serves that
 * extension, and because a frame of a screen recording as PNG runs to several
 * megabytes where this is tens of kilobytes.
 */
export const POSTER_FILE_NAME = "poster.jpg";

/**
 * The cached hover preview, beside the recording it is of.
 *
 * One image holding every frame of the preview rather than a folder of them:
 * the grid shows it by moving a background, so a strip is one request and one
 * decode where separate files would be several of each, arriving out of order.
 */
export const FILMSTRIP_FILE_NAME = "filmstrip.jpg";

/**
 * Every recording, newest first.
 *
 * A directory only counts if it holds a manifest: an interrupted take can leave
 * a folder with a half-written screen track and nothing describing it, and
 * offering that as something to open would only produce an error on click.
 *
 * Sorted by the manifest's own mtime rather than the directory's, which macOS
 * touches for reasons that have nothing to do with when the take was made.
 */
export function listProjects(dir = SESSIONS_DIR): ProjectSummary[] {
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (cause) {
    console.warn(`[library] could not read ${dir}:`, cause);
    return [];
  }

  const projects: ProjectSummary[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    try {
      projects.push({
        dir: path,
        name: displayName(path),
        createdAt: statSync(join(path, MANIFEST_FILE_NAME)).mtimeMs,
        poster: existsSync(join(path, POSTER_FILE_NAME)) ? mediaUrl(name, POSTER_FILE_NAME) : null,
        filmstrip: existsSync(join(path, FILMSTRIP_FILE_NAME))
          ? mediaUrl(name, FILMSTRIP_FILE_NAME)
          : null,
      });
    } catch {
      // No manifest, or unreadable. Not a recording we can open.
    }
  }

  return projects.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * What to call a recording.
 *
 * The folder's own name until somebody renames it, which is what every take
 * made before this existed still reports. Read straight out of the file rather
 * than through `loadProject`, which needs the manifest parsed to build the
 * defaults it would fall back to — and the fallback here is one `basename`.
 */
function displayName(dir: string): string {
  try {
    const stored = JSON.parse(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")) as {
      name?: unknown;
    };
    if (typeof stored.name === "string" && stored.name.trim() !== "") return stored.name.trim();
  } catch {
    // Never edited, or unreadable. Either way the folder's name is the answer.
  }
  return basename(dir);
}

/**
 * Renames a recording, without moving anything.
 *
 * The name is a field in `project.json`, so the directory stays exactly where
 * it is: `prequel-media://` URLs are built from its basename, `manifest.id`
 * repeats it, and the transcript is thrown away when the two disagree. Renaming
 * on disk would invalidate all three to change a label.
 *
 * Safe to write straight through `saveProject` only because the Projects grid
 * and the editor never show at once — see `windows/workspace.ts`. With an
 * editor live on this directory its next debounced save would carry the project
 * it loaded before the rename and put the old name back.
 */
export function renameProject(dir: string, name: string, root = SESSIONS_DIR): void {
  if (!insideRecordings(dir, root)) {
    console.warn(`[library] refusing to rename outside the recordings folder: ${dir}`);
    return;
  }

  const trimmed = name.trim();
  // A blank name would leave a card with no label and no way to click into it
  // and fix that. Declining is not a failure; there is simply nothing to apply.
  if (trimmed === "") return;

  const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
  const project = loadProject(dir, manifest.id, manifest.duration);

  // Creates `project.json` for a recording nobody has edited yet, which is
  // correct: a rename is an edit, and there is nowhere else to keep it.
  saveProject(dir, { ...project, name: trimmed });
}

/**
 * Caches a still the grid has just made.
 *
 * The renderer is the only process here that can decode video, so it takes the
 * frame and hands it back as a data URL. Written beside the recording rather
 * than into app support so it moves with the folder, the way `background.png`
 * already does.
 */
export function savePoster(dir: string, dataUrl: string, root = SESSIONS_DIR): void {
  writeCachedImage(dir, POSTER_FILE_NAME, dataUrl, root);
}

/** The same, for the strip of frames a tile flicks through on hover. */
export function saveFilmstrip(dir: string, dataUrl: string, root = SESSIONS_DIR): void {
  writeCachedImage(dir, FILMSTRIP_FILE_NAME, dataUrl, root);
}

function writeCachedImage(dir: string, fileName: string, dataUrl: string, root: string): void {
  if (!insideRecordings(dir, root)) {
    console.warn(`[library] refusing to write ${fileName} outside the recordings folder: ${dir}`);
    return;
  }

  const comma = dataUrl.indexOf(",");
  // Anything that is not a data URL is not a frame this wrote — refused rather
  // than decoded, because whatever `Buffer.from` made of it would be written to
  // disk and served back as an image.
  if (!dataUrl.startsWith("data:image/jpeg;base64,") || comma === -1) {
    console.warn(`[library] refusing a ${fileName} for ${dir} that is not a JPEG data URL`);
    return;
  }

  try {
    writeFileSync(join(dir, fileName), Buffer.from(dataUrl.slice(comma + 1), "base64"));
  } catch (cause) {
    // A tile without a picture, which is worse-looking rather than broken —
    // and the next time the grid opens it will simply try again.
    console.warn(`[library] could not cache ${fileName} for ${dir}:`, cause);
  }
}
