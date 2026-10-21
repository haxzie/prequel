/**
 * The hosted music library, and the tracks in it.
 *
 * All of it lives in main because none of it can live anywhere else: the
 * editor's CSP is `connect-src 'self' prequel-media:`, so a window physically
 * cannot fetch `api.prequel.sh`. The renderer asks for the catalogue over IPC
 * and plays tracks back through `prequel-media:`.
 *
 * Two caches rather than the backgrounds' three, because a track has no
 * thumbnail:
 *
 * - The catalogue is written to `userData` and served from there immediately,
 *   then re-checked in the background. A picker that waits on the network to
 *   draw anything is a picker that is empty on a train.
 * - The audio is copied into the *recording* rather than a cache. A recording
 *   that carries its own music still exports the same video on another
 *   machine, and next year — the same reasoning a background is copied in.
 */
import { copyFileSync, existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "electron";

import type { MusicCatalogue } from "../shared/contract.js";
import { apiUrl } from "./api.js";
import { log } from "./log.js";
import { shippedMusic } from "../shared/music.js";
import { BARE_M4A, fetchInto, isAudioMp4, TIMEOUT_MS } from "./media-cache.js";

/** How long a stored catalogue is served without re-checking. */
const FRESH_MS = 6 * 60 * 60 * 1000;

function cataloguePath(): string {
  return join(app.getPath("userData"), "music", "catalogue.json");
}

interface Stored {
  fetched: number;
  catalogue: MusicCatalogue;
}

/**
 * Held for the life of the process as well as on disk.
 *
 * Every editor window asks for this when the music picker is first opened, and
 * three windows should not mean three reads and three requests.
 */
let memory: Stored | null = null;
let inFlight: Promise<MusicCatalogue | null> | null = null;

async function read(): Promise<Stored | null> {
  if (memory) return memory;

  try {
    const raw = await readFile(cataloguePath(), "utf8");
    const stored = JSON.parse(raw) as Stored;
    // Shape-checked rather than trusted: this file is on the user's disk and a
    // half-written one would otherwise reach the picker as an empty list.
    if (!stored?.catalogue?.tracks?.length) return null;
    memory = stored;
    return stored;
  } catch {
    return null;
  }
}

async function write(catalogue: MusicCatalogue): Promise<void> {
  const stored: Stored = { fetched: Date.now(), catalogue };
  memory = stored;

  try {
    await mkdir(join(cataloguePath(), ".."), { recursive: true });
    // Written beside and renamed, so a process that dies mid-write leaves the
    // previous catalogue rather than a truncated one.
    const temporary = `${cataloguePath()}.tmp`;
    await writeFile(temporary, JSON.stringify(stored), "utf8");
    await rename(temporary, cataloguePath());
  } catch (cause) {
    // Not fatal. It is in memory, and the next launch fetches again.
    console.warn("[music] could not store the catalogue:", cause);
  }
}

async function download(): Promise<MusicCatalogue | null> {
  try {
    const response = await fetch(new URL("/v1/music", apiUrl()), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`the catalogue answered ${String(response.status)}`);

    const catalogue = (await response.json()) as MusicCatalogue;
    if (!Array.isArray(catalogue?.tracks) || catalogue.tracks.length === 0) {
      throw new Error("the catalogue was empty");
    }

    await write(catalogue);
    log("info", `music: ${String(catalogue.tracks.length)} in the catalogue`);
    return catalogue;
  } catch (cause) {
    console.warn("[music] could not fetch the catalogue:", cause);
    return null;
  }
}

/**
 * The catalogue, from disk if there is one and from the network otherwise.
 *
 * Stale-while-revalidate, as the backgrounds' is: a stored catalogue is
 * returned immediately and a refresh is started behind it. Null means there is
 * nothing to offer — no cache and no network — and the picker then shows only
 * what this recording already holds, which is the honest answer and not an
 * error.
 */
export async function catalogue(): Promise<MusicCatalogue | null> {
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
 * Puts one track inside a recording, so it can be played and exported.
 *
 * The one call here that takes time — a couple of megabytes — which is why the
 * picker shows a spinner on the row that has been chosen and not yet fetched.
 * Sniffed as an MP4 on the way in and on every later check: a file that is
 * present but is not audio is replaced rather than trusted, because a bad file
 * on disk outlives the mistake that produced it.
 */
export async function ensureMusic(dir: string, file: string): Promise<boolean> {
  if (!BARE_M4A.test(file)) return false;

  // The shipped track is copied rather than fetched. It is the one bed the app
  // can lay with no network at all, and asking the API for a file that is
  // already inside the bundle would make the offline case the broken one.
  if (shippedMusic(file)) return copyShipped(dir, file);

  return fetchInto(`/v1/music/raw/${file}`, join(dir, file), isAudioMp4);
}

/** Puts one of the app's own tracks inside a recording. */
function copyShipped(dir: string, file: string): boolean {
  const destination = join(dir, file);

  try {
    // Skipped when it is already there: choosing the same track twice is not a
    // reason to rewrite two megabytes.
    if (!existsSync(destination)) {
      copyFileSync(
        fileURLToPath(new URL(`../../resources/music/${file}`, import.meta.url)),
        destination,
      );
    }
    return true;
  } catch (cause) {
    console.warn(`[music] could not copy ${file}:`, cause);
    return false;
  }
}
