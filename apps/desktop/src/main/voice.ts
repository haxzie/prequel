/**
 * The cleaned microphone track, as main makes and finds it.
 *
 * The work is Apple's voice isolation unit, driven offline in Rust — see
 * `crates/prequel-voice`. It happens here rather than in the editor for the
 * reason every other file operation does: a renderer has no filesystem, and
 * the addon lives in main.
 *
 * **The file on disk is the whole cache.** A cleaned track is named after the
 * level it was cleaned at, so `mic.clean-strong.m4a` can only ever be the
 * strong pass over `mic.m4a`. There is no record anywhere of "what the file
 * was made with" to fall out of step with the file — asking for a level is a
 * `stat`, and a hit needs no state to have survived a quit, a crash or an
 * upgrade.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import type { CleanTrack } from "../shared/contract.js";
import type { MicDenoise } from "../shared/project.js";
import { log } from "./log.js";
import { mediaUrl } from "./media-protocol.js";
import { getRecorder } from "./recorder.js";
import { insideRecordings } from "./session.js";

/**
 * Passes already running, by the path they are writing.
 *
 * The editor asks for a level on the settings change and again when the
 * session reloads, and the two can overlap: without this the second pass
 * renames its own temporary file over the first one's while the first is
 * still writing it.
 */
const running = new Map<string, Promise<void>>();

/**
 * The name a cleaned track takes beside its source.
 *
 * `2/mic.m4a` cleans to `2/mic.clean-light.m4a` — beside the take it belongs
 * to rather than in the session root, so a recording extended with a second
 * take keeps one cleaned file per microphone file rather than two files
 * fighting over one name.
 */
export function cleanName(file: string, level: Exclude<MicDenoise, "off">): string {
  const dir = dirname(file);
  const stem = basename(file).replace(/\.[^.]+$/, "");
  const name = `${stem}.clean-${level}.m4a`;
  return dir === "." ? name : `${dir}/${name}`;
}

/**
 * The cleaned version of one microphone file, making it if it is not there.
 *
 * `file` is relative to `dir`, as the manifest records it. Both are checked
 * rather than trusted: they arrive from a renderer, and a `..` in either is
 * how a path in a window becomes a write outside the recordings directory.
 */
export async function cleanMic(
  dir: string,
  file: string,
  level: Exclude<MicDenoise, "off">,
): Promise<CleanTrack> {
  if (!insideRecordings(dir)) {
    throw new Error(`DENOISE_REFUSED: ${dir} is not a recording`);
  }

  const source = resolve(dir, file);
  // `relative` rather than `startsWith`: a sibling directory whose name merely
  // begins with this one's would pass a prefix test.
  const within = relative(dir, source);
  if (within.startsWith("..") || resolve(dir, within) !== source) {
    throw new Error(`DENOISE_REFUSED: ${file} is not inside the recording`);
  }
  if (!existsSync(source)) {
    throw new Error(`DENOISE_MISSING: ${file} is not there`);
  }

  const name = cleanName(file, level);
  const output = join(dir, name);
  const found: CleanTrack = { file: name, url: mediaUrl(dir, name) };

  if (existsSync(output)) return found;

  const already = running.get(output);
  if (already) {
    await already;
    return found;
  }

  const pass = (async () => {
    const started = Date.now();
    const recorder = await getRecorder();
    const written = await recorder.enhanceVoice(
      source,
      output,
      level === "light" ? "Light" : "Strong",
    );
    log(
      "info",
      `cleaned ${file} at ${level}: ${String(Math.round(written / 1000))}s of audio in ` +
        `${String(((Date.now() - started) / 1000).toFixed(1))}s`,
    );
  })();

  running.set(output, pass);
  try {
    await pass;
  } finally {
    running.delete(output);
  }

  return found;
}
