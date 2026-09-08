/**
 * Saved looks, all of them the user's own and all of them on this disk.
 *
 * This lives in main because the renderer cannot read a file — its CSP is
 * `connect-src 'self' prequel-media:`. The renderer asks over IPC and reads
 * cards back through `prequel-media://scene-preset/`.
 *
 * There was a published catalogue alongside this once, fetched and cached. It
 * is gone: a look is something you make, and one downloaded from us was a
 * second source of truth for every field `sanitiseScenePreset` repairs.
 *
 * The layout under `userData`:
 *
 *     scene-presets/
 *       presets.json           the list
 *       <id>/card.jpg          a saved card
 *       <id>/background.png    a picture a saved look carries
 *
 * A card is a file rather than base64 inside `presets.json`, which is read on
 * every editor open: a whole-file rewrite would re-write every card on every
 * save, and the media protocol can serve a file with no decode step.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import {
  PRESET_BACKGROUND_FILE,
  SCENE_PRESETS_VERSION,
  sanitiseScenePreset,
  sanitiseScenePresets,
  type ScenePreset,
  type ScenePresetsFile,
} from "../shared/scene-presets.js";
import { log } from "./log.js";

/** What a saved look's own card is called. */
const CARD_FILE = "card.jpg";

/**
 * The alphabet an id may use — the same one `sanitiseScenePreset` enforces.
 *
 * Repeated here rather than imported because this is the *path* guard: what
 * stops `../../` reaching `join`. A guard that trusted the sanitiser would be
 * one refactor away from being nothing at all.
 */
const BARE_ID = /^[a-z0-9][a-z0-9-]*$/;

function root(): string {
  return join(app.getPath("userData"), "scene-presets");
}

function listPath(): string {
  return join(root(), "presets.json");
}

/** Where a saved look's own folder is, or null for an id that is not a name. */
function presetDir(id: string): string | null {
  return BARE_ID.test(id) ? join(root(), id) : null;
}

/** Where the card for a saved look lives. Read by the media protocol. */
export function cardPath(id: string): string | null {
  const dir = presetDir(id);
  return dir && join(dir, CARD_FILE);
}

// ── The user's own ──────────────────────────────────────────────────────────

/**
 * Held for the life of the process as well as on disk, because every editor
 * window asks for this on open and three windows should not mean three reads.
 */
let saved: ScenePreset[] | null = null;

/** The looks saved on this machine, newest first. */
export async function mine(): Promise<ScenePreset[]> {
  if (saved) return saved;

  try {
    saved = sanitiseScenePresets(JSON.parse(await readFile(listPath(), "utf8")));
  } catch {
    // No file yet, or one that will not parse. An empty list either way — the
    // picker still has ours in it, and the next save writes a good file.
    saved = [];
  }

  return saved;
}

async function writeList(presets: ScenePreset[]): Promise<void> {
  saved = presets;
  const file: ScenePresetsFile = { version: SCENE_PRESETS_VERSION, presets };

  await mkdir(root(), { recursive: true });
  // Written beside and renamed, so a process that dies mid-write leaves the
  // previous list rather than a truncated one — the discipline `project.json`
  // and the background catalogue already follow.
  const temporary = `${listPath()}.tmp`;
  await writeFile(temporary, JSON.stringify(file), "utf8");
  await rename(temporary, listPath());
}

/**
 * Saves a look, its card, and any picture it carries, as one act.
 *
 * One call rather than three, because the halves are worthless apart: a preset
 * in the list whose card never arrived is a cell that will not draw and nothing
 * on screen to say why. It answers with the whole list so the renderer cannot
 * come to disagree with the disk about what is on it.
 *
 * `sessionDir` is the recording the look was taken from, and is only read when
 * the preset carries a picture of its own — see `presetBackground` in
 * `shared/scene-presets.ts` for why one ever does.
 */
export async function save(
  preset: ScenePreset,
  card: string,
  sessionDir: string | null,
  sourceFile: string | null,
  watermarkFile: string | null,
): Promise<ScenePreset[]> {
  const clean = sanitiseScenePreset(preset);
  const dir = clean && presetDir(clean.id);
  if (!clean || !dir) {
    console.warn("[scene-presets] refusing to save a preset that cannot be read back");
    return mine();
  }

  await mkdir(dir, { recursive: true });

  if (!(await writeCard(join(dir, CARD_FILE), card))) return mine();

  // The picture the look carries, copied out of the recording it was chosen in.
  // Left where it was, the preset would name a file inside one recording — see
  // the note on `source: "file"` in `shared/scene-presets.ts`.
  if (sessionDir && sourceFile) {
    try {
      await copyFile(join(sessionDir, sourceFile), join(dir, PRESET_BACKGROUND_FILE));
    } catch (cause) {
      console.warn("[scene-presets] could not carry the look's own picture:", cause);
      return mine();
    }
  }

  // The logo, under its own name rather than a renamed copy. `pickWatermarkImage`
  // names it after its own bytes, so the same file cannot mean two pictures and
  // two pictures cannot share a name — which is the whole reason the background
  // beside it has to be renamed and this does not.
  if (sessionDir && watermarkFile) {
    try {
      await copyFile(join(sessionDir, watermarkFile), join(dir, watermarkFile));
    } catch (cause) {
      console.warn("[scene-presets] could not carry the look's logo:", cause);
      return mine();
    }
  }

  const existing = (await mine()).filter((other) => other.id !== clean.id);
  const presets = [clean, ...existing].sort((a, b) => b.savedAt - a.savedAt);
  await writeList(presets);

  log("info", `scene-presets: saved ${clean.id}`);
  return presets;
}

/**
 * The card, decoded from what the preview handed back.
 *
 * `projects.ts` has the same guard and the same reason: anything that is not a
 * data URL this app produced is refused rather than decoded, because whatever
 * `Buffer.from` made of it would be written to disk and served back as an image.
 * Not exported from there, though — that one is bolted to `insideRecordings`,
 * which is the wrong root for a file that belongs to no recording.
 */
async function writeCard(path: string, dataUrl: string): Promise<boolean> {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/jpeg;base64,") || comma === -1) {
    console.warn("[scene-presets] refusing a card that is not a JPEG data URL");
    return false;
  }

  try {
    await writeFile(path, Buffer.from(dataUrl.slice(comma + 1), "base64"));
    return true;
  } catch (cause) {
    console.warn("[scene-presets] could not write the card:", cause);
    return false;
  }
}

/** Renames one. A blank name is declined, as renaming a recording is. */
export async function renamePreset(id: string, name: string): Promise<ScenePreset[]> {
  const trimmed = name.trim();
  const presets = await mine();
  if (trimmed === "" || !presets.some((preset) => preset.id === id)) return presets;

  const next = presets.map((preset) => (preset.id === id ? { ...preset, name: trimmed } : preset));
  await writeList(next);
  return next;
}

/**
 * Forgets one.
 *
 * The entry goes even when the folder will not, which is deliberate: an orphan
 * card in a cache directory is nothing, and a cell for a preset that is gone is
 * a click that does nothing.
 */
export async function remove(id: string): Promise<ScenePreset[]> {
  const next = (await mine()).filter((preset) => preset.id !== id);
  await writeList(next);

  const dir = presetDir(id);
  if (dir) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (cause) {
      console.warn(`[scene-presets] could not remove ${id}'s folder:`, cause);
    }
  }

  return next;
}

/**
 * Puts a carried logo inside the recording, under the name it already has.
 *
 * No renaming, unlike `applyImage` below: the name is a hash of the picture, so
 * applying the same look to two recordings puts the same file in both and
 * applying two looks that share a logo copies it once.
 */
export async function applyWatermark(id: string, dir: string, file: string): Promise<boolean> {
  const from = presetDir(id);
  if (!from || !/^watermark-[a-z0-9]+\.png$/i.test(file)) return false;

  const destination = join(dir, file);

  try {
    if (!existsSync(destination)) await copyFile(join(from, file), destination);
    return true;
  } catch (cause) {
    console.warn(`[scene-presets] could not copy ${id}'s logo into ${dir}:`, cause);
    return false;
  }
}

/**
 * Puts a carried picture inside the recording, so it can be drawn and exported.
 *
 * Named for the preset rather than kept as `background.png`, so two looks
 * applied to the same recording cannot land on one file — the collision this
 * whole path exists to avoid. `copyPresetBackground` in `wallpaper.ts` is the
 * same move from the bundle's own folder.
 */
export async function applyImage(id: string, dir: string): Promise<string | null> {
  const from = presetDir(id);
  if (!from) return null;

  const file = `preset-${id}.png`;
  const destination = join(dir, file);

  try {
    // Skipped when it is there: applying the same look twice is not a reason to
    // rewrite a megabyte.
    if (!existsSync(destination)) {
      await copyFile(join(from, PRESET_BACKGROUND_FILE), destination);
    }
    return file;
  } catch (cause) {
    console.warn(`[scene-presets] could not copy ${id}'s picture into ${dir}:`, cause);
    return null;
  }
}
