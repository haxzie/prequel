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
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "electron";

import { BACKGROUND_PRESETS } from "../shared/backgrounds.js";
import type { BackgroundsCatalogue } from "../shared/contract.js";
import { apiUrl } from "./api.js";
import { log } from "./log.js";
import { libraryParts, libraryRef } from "../shared/library.js";
import { shelfDir } from "./library.js";
import { BARE_JPEG, fetchInto, TIMEOUT_MS } from "./media-cache.js";

/** How long a stored catalogue is served without re-checking. */
const FRESH_MS = 6 * 60 * 60 * 1000;

function cacheDir(): string {
  return join(app.getPath("userData"), "backgrounds");
}

function cataloguePath(): string {
  return join(cacheDir(), "catalogue.json");
}

/** Where a downloaded thumbnail lives. Bare names only; the API refuses others. */
export function thumbnailPath(file: string): string | null {
  return BARE_JPEG.test(file) ? join(cacheDir(), "thumbnails", file) : null;
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

/** Downloads a thumbnail into the cache. Answers whether it is there now. */
export async function ensureThumbnail(file: string): Promise<boolean> {
  const destination = thumbnailPath(file);
  if (!destination) return false;
  return fetchInto(`/v1/backgrounds/thumbnail/${file}`, destination);
}

/**
 * Puts the full picture in the library, so it can be drawn and exported.
 *
 * The one that takes time — a couple of megabytes — and the reason the picker
 * shows a spinner on a swatch that has been chosen but not yet fetched. Once,
 * for the machine: it went into the recording before, which put the same
 * picture on disk once per project that used it — see `shared/library.ts`.
 *
 * Answers the reference a project stores rather than a bare name, so the one
 * place that knows where these live is the one that writes the pointer.
 */
export async function ensureBackground(path: string): Promise<string | null> {
  // Either way round. A saved look names its picture the way the project it
  // was taken from did — bare on one saved before the library existed, a
  // reference on one saved since — and both mean the same picture.
  const file = libraryParts(path)?.file ?? path;
  if (!BARE_JPEG.test(file)) return null;

  const destination = join(shelfDir("backgrounds"), file);
  const reference = libraryRef("backgrounds", file);

  // A picture that ships inside the app is copied rather than fetched, the way
  // the shipped music track is: it is the one background a machine with no
  // network can lay, and asking the API for a file already in the bundle would
  // make the offline case the broken one.
  if (BACKGROUND_PRESETS.some((preset) => preset.file === file)) {
    return copyShipped(file, destination) ? reference : null;
  }

  return (await fetchInto(`/v1/backgrounds/raw/${file}`, destination)) ? reference : null;
}

/** Puts one of the app's own pictures on the shelf. */
function copyShipped(file: string, destination: string): boolean {
  try {
    // Skipped when it is already there — picking the same background twice is
    // not a reason to rewrite a megabyte.
    if (!existsSync(destination)) {
      mkdirSync(join(destination, ".."), { recursive: true });
      copyFileSync(
        fileURLToPath(new URL(`../../resources/backgrounds/${file}`, import.meta.url)),
        destination,
      );
    }
    return true;
  } catch (cause) {
    console.warn(`[backgrounds] could not copy ${file}:`, cause);
    return false;
  }
}
