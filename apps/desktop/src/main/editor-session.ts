/**
 * Everything the editor window needs to open a recording.
 *
 * Assembled in main because two of the three pieces cannot come from anywhere
 * else: the manifest is read off disk, and the media URLs are built here so the
 * renderer never has to know — or be trusted with — a filesystem path.
 */
import { copyFileSync, existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { EditorSession, TrackMedia } from "../shared/contract.js";
import { dialog, shell, type BrowserWindow } from "electron";

import type { Manifest, TrackKind } from "../shared/manifest.js";
import { MANIFEST_FILE_NAME, parseManifest } from "../shared/manifest.js";
import type { CursorLayer } from "../shared/contract.js";
import { CURSOR_FILES } from "../shared/contract.js";
import type { Project } from "../shared/project.js";
import { FALLBACK_BACKGROUND } from "../shared/project.js";
import type { Transcript } from "../shared/transcript.js";
import { TRANSCRIPT_FILE_NAME, parseTranscript } from "../shared/transcript.js";
import { loadProject } from "./editor-project.js";
import { log } from "./log.js";
import { mediaUrl } from "./media-protocol.js";
import { insideRecordings } from "./session.js";
import { getRecorder, type TrackProbe } from "./recorder.js";
import { ensureWallpaper } from "./wallpaper.js";

/**
 * Reads one recording into the payload its editor window needs.
 *
 * The probe is best-effort. A recording is still editable without the media's
 * own account of itself — the manifest already describes every track — so a
 * probe failure degrades the editor rather than refusing to open it.
 */
export async function readEditorSession(dir: string): Promise<EditorSession> {
  const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));

  let probes: TrackProbe[] = [];
  try {
    probes = await (await getRecorder()).probeSession(dir);
  } catch (cause) {
    console.warn(`[editor] could not probe ${dir}:`, cause);
  }

  const byKind = new Map(probes.map((probe) => [probe.kind as TrackKind, probe]));

  const media: TrackMedia[] = manifest.tracks.map((track) => {
    const probe = byKind.get(track.kind);
    return {
      kind: track.kind,
      url: mediaUrl(dir, track.file_name),
      // From the manifest, which is the only place a late start is recorded:
      // every session file is written zero-based, so the file itself cannot
      // say when its track began. Subtracting a probed start as well would
      // double-count the correction.
      offset: track.start,
      // Preferring the media's own account where there is one: the manifest
      // records what the recorder believed it wrote, and a struggling pipeline
      // can leave the two disagreeing.
      duration: probe?.duration ?? track.end - track.start,
      width: probe?.width ?? track.width ?? null,
      height: probe?.height ?? track.height ?? null,
      frameRate: probe?.frameRate ?? null,
    };
  });

  return {
    dir,
    name: basename(dir),
    manifest,
    media,
    cursor: cursorLayer(dir, manifest),
    project: await withBackground(
      dir,
      // `area` and `window` both keep the card; only a whole screen drops it.
      loadProject(dir, manifest.id, manifest.duration, manifest.source.kind === "display"),
    ),
    transcript: readTranscript(dir, manifest.id),
  };
}

/**
 * The recording's transcript, or null when there is nothing usable beside it.
 *
 * Discarded rather than repaired. A transcript from a version this build does
 * not know, or one carrying a different recording's id — a directory copied, a
 * session restored from a backup — is not a file to salvage: transcribing again
 * is cheap and produces something certainly correct, where a repair produces
 * something plausibly wrong.
 */
function readTranscript(dir: string, recordingId: string): Transcript | null {
  const file = join(dir, TRANSCRIPT_FILE_NAME);
  if (!existsSync(file)) return null;

  try {
    const transcript = parseTranscript(readFileSync(file, "utf8"), recordingId);
    if (!transcript) {
      console.warn(`[editor] ignoring an unusable ${TRANSCRIPT_FILE_NAME} in ${dir}`);
    }
    return transcript;
  } catch (cause) {
    // Never fatal. The recording is still perfectly editable; it simply has no
    // captions until it is transcribed again.
    console.warn(`[editor] could not read ${TRANSCRIPT_FILE_NAME} in ${dir}:`, cause);
    return null;
  }
}

/**
 * Moves a whole recording to the Trash.
 *
 * The Trash rather than `rm -rf`: this is minutes of someone's work and every
 * file that made it, and an undo that only Finder can offer is worth far more
 * than the tidiness of removing it outright.
 *
 * Confirmed first, and modal to the window that asked so it cannot be missed
 * behind it. Returns false when declined, so the caller can tell that from a
 * failure.
 *
 * What happens to the window afterwards is the caller's: the Projects grid and
 * the editor share one window now, and deleting the recording on screen means
 * going back to the grid rather than closing the app's only window.
 */
export async function deleteRecording(dir: string, window: BrowserWindow | null): Promise<boolean> {
  // The path comes from a renderer, which is the least-trusted process in the
  // app, and this moves an entire directory tree. Guarded the way every other
  // library operation is.
  if (!insideRecordings(dir)) {
    console.warn(`[library] refusing to trash outside the recordings folder: ${dir}`);
    return false;
  }

  const { response } = await dialog.showMessageBox(window ?? undefined!, {
    type: "warning",
    buttons: ["Move to Trash", "Cancel"],
    defaultId: 1,
    // Escape and the close button both land on Cancel: the destructive choice
    // should never be the one a stray keypress takes.
    cancelId: 1,
    message: `Delete "${basename(dir)}"?`,
    detail:
      "The recording, its edit and everything exported from it move to the Trash. " +
      "You can put them back from there.",
  });

  if (response !== 0) return false;

  await shell.trashItem(dir);
  log("info", `moved ${dir} to the Trash`);
  return true;
}

/**
 * The pointer image, copied into the recording the first time it is needed.
 *
 * Copied rather than referenced from the app bundle so a recording directory
 * stays self-contained — the same rule the wallpaper follows, and the reason a
 * recording can be moved to another machine and still export identically. It
 * also means both rasterisers resolve it the way they already resolve a
 * background: a name relative to the session directory.
 *
 * Null when the pointer was baked into the frames, which is every recording
 * made before it became a layer. Drawing one then would show two.
 */
function cursorLayer(dir: string, manifest: Manifest): CursorLayer | null {
  if (manifest.cursor_baked ?? true) return null;
  if (!manifest.cursor?.length) return null;

  // Every image, not just the selected style's: which is chosen is a project
  // setting that changes after this runs, and the hand is chosen by the
  // recording rather than by anyone. They are a couple of kilobytes each.
  for (const file of CURSOR_FILES) {
    const target = join(dir, file);
    if (existsSync(target)) continue;

    try {
      copyFileSync(fileURLToPath(new URL(`../../resources/${file}`, import.meta.url)), target);
    } catch (cause) {
      // Without the image there is no pointer, which is a recording that looks
      // like it was made with the cursor hidden — not a broken editor.
      console.warn(`[editor] could not provide ${file} for ${dir}:`, cause);
      return null;
    }
  }

  return {
    samples: manifest.cursor,
    typing: manifest.typing ?? [],
    clicks: (manifest.clicks ?? []).map((click) => click.at),
    keys: manifest.keys ?? [],
  };
}

/**
 * Makes sure a project's wallpaper background actually has an image.
 *
 * A fresh project defaults to the desktop picture, which has to be copied into
 * the recording before it can be drawn. When that fails — no Screen Recording
 * grant, or a machine with nothing to capture — the background falls back to a
 * gradient rather than rendering as a placeholder that looks like a bug.
 *
 * Only the project defaults are repaired. A slice that overrides its background
 * was set deliberately, and quietly rewriting it would undo a decision.
 */
async function withBackground(dir: string, project: Project): Promise<Project> {
  const background = project.defaults.background.background;
  if (background.kind !== "image" || background.source !== "wallpaper") return project;

  if (await ensureWallpaper(dir)) return project;

  console.warn(`[editor] no wallpaper for ${dir}; falling back to a gradient`);
  return {
    ...project,
    defaults: {
      ...project.defaults,
      background: { ...project.defaults.background, background: FALLBACK_BACKGROUND },
    },
  };
}
