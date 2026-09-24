/**
 * Fetching a picture from the API onto disk, safely, once.
 *
 * Lifted out of `backgrounds.ts` when the scene presets needed the same thing.
 * One implementation rather than two, and the reason is written into `isJpeg`
 * below: a second copy is a second place for the same bug to happen, and that
 * bug left a file on disk that outlived the mistake that produced it by weeks.
 *
 * All of it lives in main because none of it can live anywhere else — the
 * renderer's CSP is `connect-src 'self' prequel-media:`, so a window physically
 * cannot reach `api.prequel.sh`.
 */
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { apiUrl } from "./api.js";

/** Long enough to fail on a bad connection, short enough not to hang a picker. */
export const TIMEOUT_MS = 15_000;

/** Bare names only, so there is no path in a name and nothing to traverse. */
export const BARE_JPEG = /^[a-z0-9][a-z0-9-]*\.jpg$/i;

/**
 * Whether these bytes are actually a JPEG.
 *
 * `FF D8 FF` is the start of every one. Checked because `response.ok` is not
 * enough to know a picture was served: an app pointed at the wrong port once
 * got somebody else's dev server, which answered `200` with an HTML page, and
 * that page was written to disk as `indigo.jpg`. It then looked like a
 * downloaded background for ever — `existsSync` was true, so it was never
 * fetched again, and the editor simply could not draw it.
 */
export function isJpeg(head: Buffer): boolean {
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

/**
 * Whether these bytes are a font file the engine can load.
 *
 * `wOF2`, `wOFF`, the TrueType `00 01 00 00` and the CFF `OTTO`, which are
 * every container the catalogue accepts. The same reason `isJpeg` exists: a
 * page of HTML saved under a font's name would be "there" for ever and load
 * as nothing.
 */
export function isFont(head: Buffer): boolean {
  if (head.length < 4) return false;
  const tag = head.subarray(0, 4).toString("latin1");
  return tag === "wOF2" || tag === "wOFF" || tag === "OTTO" || tag === "\0\u0001\0\0";
}

/** The same check against a file already on disk. */
export function fileIs(path: string, check: (head: Buffer) => boolean): boolean {
  let handle: number | undefined;
  try {
    handle = openSync(path, "r");
    const head = Buffer.alloc(4);
    const read = readSync(handle, head, 0, 4, 0);
    return check(head.subarray(0, read));
  } catch {
    return false;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

/**
 * Fetches one file from the API into `destination`, unless it is there.
 *
 * Written beside and renamed, so a process that dies mid-write leaves nothing
 * rather than a half-downloaded JPEG — which decodes to nothing and would be
 * cached as if it had worked.
 *
 * A file that is present but does not pass `check` is replaced rather than
 * trusted. See `isJpeg`: existence alone is how a page of HTML came to sit in
 * a recording under a picture's name, and nothing ever went back for it.
 * The check is a parameter because fonts take the same route as pictures and
 * a JPEG sniff would refuse every one of them.
 */
export async function fetchInto(
  path: string,
  destination: string,
  check: (head: Buffer) => boolean = isJpeg,
): Promise<boolean> {
  if (existsSync(destination)) {
    if (fileIs(destination, check)) return true;
    console.warn(`[media-cache] ${destination} is not what it should be; fetching it again`);
  }

  try {
    const response = await fetch(new URL(path, apiUrl()), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error(`${path} was empty`);
    if (!check(bytes)) {
      // Whatever answered, it was not the API. Refused rather than written,
      // because a bad file on disk outlives the mistake that produced it.
      throw new Error(`${path} did not answer with the file asked for`);
    }

    await mkdir(join(destination, ".."), { recursive: true });
    const temporary = `${destination}.part`;
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
    return true;
  } catch (cause) {
    console.warn(`[media-cache] could not fetch ${path}:`, cause);
    return false;
  }
}
