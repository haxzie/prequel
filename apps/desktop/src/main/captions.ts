/**
 * Putting caption bitmaps inside a recording.
 *
 * The renderer lays a cue out and draws it — it is the only thing here with a
 * font engine — but it cannot write a file: the editor's CSP is
 * `connect-src 'self' prequel-media:` and there is no filesystem in a window at
 * all. So the pixels come over IPC and land here.
 *
 * They go inside the session directory rather than a cache so a recording stays
 * self-contained: copied to another machine, it still exports the same video.
 * `prequel-media:` already serves `.png` from there, so the preview reads the
 * same files the exporter decodes.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** The directory cue bitmaps live in, relative to the recording. */
export const CAPTIONS_DIR = "captions";

/**
 * Writes one cue bitmap, unless it is already there.
 *
 * Skipped when the file exists because the name is a hash of everything the
 * pixels depend on: the same name is the same picture, and rewriting it on
 * every keystroke of a slider would be a megabyte of disk per frame of drag.
 */
export async function writeCaption(
  dir: string,
  file: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const path = within(dir, file);
  if (!path) {
    console.warn(`[captions] refused a bitmap outside the recording: ${file}`);
    return null;
  }

  try {
    if (existsSync(path)) return file;
    await mkdir(join(dir, CAPTIONS_DIR), { recursive: true });
    await writeFile(path, bytes);
    return file;
  } catch (cause) {
    console.warn(`[captions] could not write ${file}:`, cause);
    return null;
  }
}

/**
 * Deletes cue bitmaps nothing refers to any more.
 *
 * Every change to the look or the size writes a new set under new names, so
 * without this a long editing session accretes a bitmap per cue per style the
 * user tried. Swept rather than reference-counted: the caller knows the whole
 * set that is live, and a file not in it is not wanted by anyone.
 *
 * A failure here is not worth reporting. The cost of a stale bitmap is disk,
 * and the alternative is an error over a successful edit.
 */
export async function sweepCaptions(dir: string, keep: readonly string[]): Promise<void> {
  const wanted = new Set(keep);

  try {
    const entries = await readdir(join(dir, CAPTIONS_DIR));

    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".png"))
        .map((entry) => `${CAPTIONS_DIR}/${entry}`)
        .filter((file) => !wanted.has(file))
        .map(async (file) => {
          const path = within(dir, file);
          if (path) await unlink(path).catch(() => undefined);
        }),
    );
  } catch {
    // No directory yet, which is the normal state before anyone asks for
    // captions. Nothing to sweep is not a failure.
  }
}

/**
 * The absolute path a caption file resolves to, or null if it escapes.
 *
 * The renderer names these, and a name is a string that came from a window.
 * `resolve` collapses `..` before the check, so a name that climbs out of the
 * recording is refused rather than written.
 */
function within(dir: string, file: string): string | null {
  const root = resolve(dir, CAPTIONS_DIR);
  const path = resolve(dir, file);
  return path.startsWith(`${root}/`) && path.endsWith(".png") ? path : null;
}
