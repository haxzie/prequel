/**
 * Bringing an audio file of the user's own into a recording, for the music row.
 *
 * Copied rather than referenced, exactly as imported footage is: the media
 * protocol will not serve anything outside the recordings folder and the
 * exporter resolves a name against the session directory, so a recording that
 * pointed at somebody's Downloads folder would edit until the file moved and
 * then export in silence.
 *
 * Copied, and not converted. An imported video is re-containered because both
 * halves of the app have to decode the picture, but `AUDIO_KINDS` is already
 * the set both halves read — so re-encoding would spend a minute of somebody's
 * time to make a worse-sounding copy of a file that worked.
 */
import { copyFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { existsSync } from "node:fs";

import { dialog } from "electron";

import type { ImportedAudio } from "../shared/contract.js";
import { AUDIO_KINDS } from "../shared/music.js";
import { log } from "./log.js";
import { getRecorder } from "./recorder.js";
import { fingerprint } from "./wallpaper.js";

/**
 * Lets the user choose a piece of audio to lay under the video.
 *
 * Named from the file's own bytes, for the reason `pickBackgroundImage` is:
 * two different files are two different names, the same file chosen twice
 * costs nothing, and a fixed name like `music-custom.m4a` would leave the
 * preview playing the first import for ever — the project's stored string
 * would not change, so nothing downstream would notice.
 *
 * Null when the sheet was dismissed, and also when the file has no sound in it
 * at all. The second is not a failure worth reporting either: a video dropped
 * in here by mistake is better answered by nothing appearing on the row than
 * by a bed that plays silence.
 */
export async function pickAudioFile(dir: string): Promise<ImportedAudio | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose audio",
    properties: ["openFile"],
    filters: [{ name: "Audio", extensions: [...AUDIO_KINDS] }],
  });

  const source = filePaths[0];
  if (canceled || !source) return null;

  // Lower-cased, because the name goes into a `prequel-media:` URL and into a
  // path the exporter checks against a lower-case pattern. `.AIFF` off a
  // camera is otherwise a file every one of those refuses.
  const extension = extname(source).toLowerCase();
  if (!AUDIO_KINDS.some((kind) => extension === `.${kind}`)) {
    console.warn(`[music] ${source} is not an audio file this build can play`);
    return null;
  }

  const name = `music-${await fingerprint(source)}${extension}`;
  const destination = join(dir, name);

  if (!existsSync(destination)) {
    try {
      await copyFile(source, destination);
    } catch (cause) {
      console.warn("[music] could not copy the chosen audio:", cause);
      return null;
    }
  }

  // Probed after the copy, like an imported video's: it is the file the editor
  // will actually play that has to be measured, and AVFoundation is about to
  // open it either way.
  let duration = 0;
  try {
    const probe = await (await getRecorder()).probeMedia(destination);
    if (!probe.hasAudio || probe.duration <= 0) {
      console.warn(`[music] ${source} has no sound in it`);
      return null;
    }
    duration = probe.duration;
  } catch (cause) {
    console.warn(`[music] could not probe ${destination}:`, cause);
    return null;
  }

  log("info", `music: imported ${name} (${String(Math.round(duration / 1e9))}s)`);

  return {
    file: name,
    // The name it had, not the name it has. `music-9f3a….mp3` is a true
    // description of the file and tells nobody which song it is.
    label: basename(source, extname(source)),
    duration,
  };
}
