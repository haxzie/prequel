/**
 * Putting caption and text bitmaps inside a recording.
 *
 * The renderer lays a cue or a title out and draws it — it is the only thing
 * here with a font engine — but it cannot write a file: the editor's CSP is
 * `connect-src 'self' prequel-media:` and there is no filesystem in a window at
 * all. So the pixels come over IPC and land here.
 *
 * They go inside the session directory rather than a cache so a recording stays
 * self-contained: copied to another machine, it still exports the same video.
 * `prequel-media:` already serves `.png` from there, so the preview reads the
 * same files the exporter decodes.
 *
 * Captions and texts each have a folder of their own, and every call names
 * which. One folder would do for writing; it would not do for sweeping, where
 * each hook hands over the set *it* still needs, and a sweep of one folder
 * with the other's list would delete every bitmap the other had just drawn.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** The directories bitmaps live in, relative to the recording. */
export const BITMAP_DIRS = ["captions", "texts", "cursor"] as const;
export type BitmapKind = (typeof BITMAP_DIRS)[number];

/** Narrows a kind that came over IPC, which is a string from a window. */
function bitmapDir(kind: unknown): BitmapKind | null {
  return BITMAP_DIRS.find((dir) => dir === kind) ?? null;
}

/**
 * Writes one bitmap, unless it is already there.
 *
 * Skipped when the file exists because the name is a hash of everything the
 * pixels depend on: the same name is the same picture, and rewriting it on
 * every keystroke of a slider would be a megabyte of disk per frame of drag.
 */
export async function writeBitmap(
  kind: unknown,
  dir: string,
  file: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const folder = bitmapDir(kind);
  const path = folder ? within(dir, folder, file) : null;
  if (!folder || !path) {
    console.warn(`[bitmaps] refused a bitmap outside the recording: ${file}`);
    return null;
  }

  try {
    if (existsSync(path)) return file;
    await mkdir(join(dir, folder), { recursive: true });
    await writeFile(path, bytes);
    return file;
  } catch (cause) {
    console.warn(`[bitmaps] could not write ${file}:`, cause);
    return null;
  }
}

/**
 * Deletes bitmaps of one kind that nothing refers to any more.
 *
 * Every change to the look or the size writes a new set under new names, so
 * without this a long editing session accretes a bitmap per cue per style the
 * user tried. Swept rather than reference-counted: the caller knows the whole
 * set that is live, and a file not in it is not wanted by anyone.
 *
 * A failure here is not worth reporting. The cost of a stale bitmap is disk,
 * and the alternative is an error over a successful edit.
 */
export async function sweepBitmaps(
  kind: unknown,
  dir: string,
  keep: readonly string[],
): Promise<void> {
  const folder = bitmapDir(kind);
  if (!folder) return;
  const wanted = new Set(keep);

  try {
    const entries = await readdir(join(dir, folder));

    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".png"))
        .map((entry) => `${folder}/${entry}`)
        .filter((file) => !wanted.has(file))
        .map(async (file) => {
          const path = within(dir, folder, file);
          if (path) await unlink(path).catch(() => undefined);
        }),
    );
  } catch {
    // No directory yet, which is the normal state before anyone asks for
    // captions or texts. Nothing to sweep is not a failure.
  }
}

/**
 * The absolute path a bitmap file resolves to, or null if it escapes.
 *
 * The renderer names these, and a name is a string that came from a window.
 * `resolve` collapses `..` before the check, so a name that climbs out of the
 * recording — or into the other kind's folder — is refused rather than
 * written.
 */
function within(dir: string, folder: BitmapKind, file: string): string | null {
  const root = resolve(dir, folder);
  const path = resolve(dir, file);
  return path.startsWith(`${root}/`) && path.endsWith(".png") ? path : null;
}
