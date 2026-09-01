/**
 * The hosted background catalogue, and the pictures in it.
 *
 * All of it lives in main because none of it can live anywhere else: the
 * editor's CSP is `connect-src 'self' prequel-media:`, so a window physically
 * cannot fetch `api.prequel.sh`. The renderer asks for the catalogue over IPC
 * and reads pictures back through `prequel-media:`.
 *
 * Three caches, each for a different reason:
 *
 * - The catalogue is written to `userData` and served from there immediately,
 *   then re-checked in the background. A picker that waits on the network to
 *   draw anything is a picker that is empty on a train.
 * - Thumbnails are kept in `userData` for ever. They are twenty kilobytes and
 *   the file name never changes meaning — see the note on renaming in the
 *   backgrounds skill.
 * - The full picture is copied into the *recording* rather than a cache, which
 *   is what it has always done. A recording that carries its own background
 *   still exports the same video on another machine, and next year.
 */
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import type { BackgroundsCatalogue } from "../shared/contract.js";
import { apiUrl } from "./api.js";
import { log } from "./log.js";

/** How long a stored catalogue is served without re-checking. */
const FRESH_MS = 6 * 60 * 60 * 1000;

/** Long enough to fail on a bad connection, short enough not to hang a picker. */
const TIMEOUT_MS = 15_000;

function cacheDir(): string {
  return join(app.getPath("userData"), "backgrounds");
}

function cataloguePath(): string {
  return join(cacheDir(), "catalogue.json");
}

/** Where a downloaded thumbnail lives. Bare names only; the API refuses others. */
export function thumbnailPath(file: string): string | null {
  return /^[a-z0-9][a-z0-9-]*\.jpg$/i.test(file) ? join(cacheDir(), "thumbnails", file) : null;
}

interface Stored {
  fetched: number;
  catalogue: BackgroundsCatalogue;
}

/**
 * Held for the life of the process as well as on disk.
 *
 * Every editor window asks for this on open, and three windows should not mean
 * three reads and three requests.
 */
let memory: Stored | null = null;
let inFlight: Promise<BackgroundsCatalogue | null> | null = null;

async function read(): Promise<Stored | null> {
  if (memory) return memory;

  try {
    const raw = await readFile(cataloguePath(), "utf8");
    const stored = JSON.parse(raw) as Stored;
    // Shape-checked rather than trusted: this file is on the user's disk and a
    // half-written one would otherwise reach the picker as an empty list.
    if (!stored?.catalogue?.backgrounds?.length) return null;
    memory = stored;
    return stored;
  } catch {
    return null;
  }
}

async function write(catalogue: BackgroundsCatalogue): Promise<void> {
  const stored: Stored = { fetched: Date.now(), catalogue };
  memory = stored;

  try {
    await mkdir(cacheDir(), { recursive: true });
    // Written beside and renamed, so a process that dies mid-write leaves the
    // previous catalogue rather than a truncated one.
    const temporary = `${cataloguePath()}.tmp`;
    await writeFile(temporary, JSON.stringify(stored), "utf8");
    await rename(temporary, cataloguePath());
  } catch (cause) {
    // Not fatal. It is in memory, and the next launch fetches again.
    console.warn("[backgrounds] could not store the catalogue:", cause);
  }
}

async function download(): Promise<BackgroundsCatalogue | null> {
  try {
    const response = await fetch(new URL("/v1/backgrounds", apiUrl()), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`the catalogue answered ${response.status}`);

    const catalogue = (await response.json()) as BackgroundsCatalogue;
    if (!Array.isArray(catalogue?.backgrounds) || catalogue.backgrounds.length === 0) {
      throw new Error("the catalogue was empty");
    }

    await write(catalogue);
    log("info", `backgrounds: ${catalogue.backgrounds.length} in the catalogue`);
    return catalogue;
  } catch (cause) {
    console.warn("[backgrounds] could not fetch the catalogue:", cause);
    return null;
  }
}

/**
 * The catalogue, from disk if there is one and from the network otherwise.
 *
 * Stale-while-revalidate: a stored catalogue is returned immediately and a
 * refresh is started behind it, so the picker draws at once and picks up new
 * pictures on the next open. Null means there is nothing to show — no cache and
 * no network — and the caller falls back to what the app ships.
 */
export async function catalogue(): Promise<BackgroundsCatalogue | null> {
  const stored = await read();

  if (stored) {
    if (Date.now() - stored.fetched > FRESH_MS && !inFlight) {
      // Deliberately not awaited. The point is that it does not block.
      inFlight = download().finally(() => {
        inFlight = null;
      });
    }
    return stored.catalogue;
  }

  inFlight ??= download().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

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
function isJpeg(head: Buffer): boolean {
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

/** The same check against a file already on disk, for repairing a poisoned one. */
function fileIsJpeg(path: string): boolean {
  let handle: number | undefined;
  try {
    handle = openSync(path, "r");
    const head = Buffer.alloc(3);
    // A file too short to hold the marker reads fewer bytes, and the slice is
    // then shorter than three, which `isJpeg` refuses.
    const read = readSync(handle, head, 0, 3, 0);
    return isJpeg(head.subarray(0, read));
  } catch {
    return false;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

/**
 * Fetches one picture from the API into `destination`, unless it is there.
 *
 * Written beside and renamed for the reason the catalogue is: a half-downloaded
 * JPEG is a background that decodes to nothing, and it would be cached as if it
 * had worked.
 *
 * A file that is present but is not a JPEG is replaced rather than trusted. See
 * `isJpeg` — existence alone was how a page of HTML came to sit in a recording
 * under a picture's name, and nothing ever went back for it.
 */
async function fetchInto(path: string, destination: string): Promise<boolean> {
  if (existsSync(destination)) {
    if (fileIsJpeg(destination)) return true;
    console.warn(`[backgrounds] ${destination} is not a picture; fetching it again`);
  }

  try {
    const response = await fetch(new URL(path, apiUrl()), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error(`${path} was empty`);
    if (!isJpeg(bytes)) {
      // Whatever answered, it was not the API. Refused rather than written,
      // because a bad file on disk outlives the mistake that produced it.
      throw new Error(`${path} did not answer with a JPEG`);
    }

    await mkdir(join(destination, ".."), { recursive: true });
    const temporary = `${destination}.part`;
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
    return true;
  } catch (cause) {
    console.warn(`[backgrounds] could not fetch ${path}:`, cause);
    return false;
  }
}

/** Downloads a thumbnail into the cache. Answers whether it is there now. */
export async function ensureThumbnail(file: string): Promise<boolean> {
  const destination = thumbnailPath(file);
  if (!destination) return false;
  return fetchInto(`/v1/backgrounds/thumbnail/${file}`, destination);
}

/**
 * Puts the full picture inside a recording, so it can be drawn and exported.
 *
 * The one that takes time — a couple of megabytes — and the reason the picker
 * shows a spinner on a swatch that has been chosen but not yet fetched.
 */
export async function ensureBackground(dir: string, file: string): Promise<boolean> {
  if (!/^[a-z0-9][a-z0-9-]*\.jpg$/i.test(file)) return false;
  return fetchInto(`/v1/backgrounds/raw/${file}`, join(dir, file));
}
