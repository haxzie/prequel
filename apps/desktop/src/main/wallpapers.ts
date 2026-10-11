/**
 * The drawn backgrounds: the hosted catalogue, and the files they draw into.
 *
 * Two halves, and they are here together because both of them are things a
 * window cannot do. The catalogue is a fetch, and the renderer's CSP is
 * `connect-src 'self' prequel-media:`; the file is a write, and there is no
 * filesystem in a window at all. The drawing itself is the renderer's — it is
 * the only side of the app with something that can rasterise — so the bytes
 * arrive here already made.
 *
 * Unlike `backgrounds.ts`, nothing here is load-bearing for the feature. A
 * drawn background needs no network: the catalogue only carries palettes added
 * since this build, and with neither a cache nor a connection the picker shows
 * the eight the app was built with.
 */
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import type { WallpaperCatalogue } from "../shared/wallpapers.js";
import { apiUrl } from "./api.js";
import { log } from "./log.js";
import { TIMEOUT_MS } from "./media-cache.js";

/** How long a stored catalogue is served without re-checking. */
const FRESH_MS = 6 * 60 * 60 * 1000;

/**
 * The names this will write.
 *
 * A bare name under the session directory and nothing else: the renderer hands
 * over a path as well as bytes, and a window is not a thing to take a path from
 * without checking it. `wallpaperFile` is what produces these.
 */
const DRAWN = /^pattern-[a-z0-9-]+-v\d+-\d+x\d+\.png$/;

function cataloguePath(): string {
  return join(app.getPath("userData"), "wallpapers.json");
}

interface Stored {
  fetched: number;
  catalogue: WallpaperCatalogue;
}

/** Held for the life of the process as well as on disk: every editor window
    asks for this on open, and three windows are not three requests. */
let memory: Stored | null = null;
let inFlight: Promise<WallpaperCatalogue | null> | null = null;

async function read(): Promise<Stored | null> {
  if (memory) return memory;

  try {
    const stored = JSON.parse(await readFile(cataloguePath(), "utf8")) as Stored;
    // Shape-checked rather than trusted. This file is on the user's disk, and a
    // half-written one would reach the picker as a list with no palettes in it.
    if (!stored?.catalogue?.palettes?.length || !stored.catalogue.styles?.length) return null;
    memory = stored;
    return stored;
  } catch {
    return null;
  }
}

async function store(catalogue: WallpaperCatalogue): Promise<void> {
  memory = { fetched: Date.now(), catalogue };

  try {
    // Written beside and renamed, so a process that dies mid-write leaves the
    // previous catalogue rather than a truncated one.
    const temporary = `${cataloguePath()}.tmp`;
    await writeFile(temporary, JSON.stringify(memory), "utf8");
    await rename(temporary, cataloguePath());
  } catch (cause) {
    console.warn("[wallpapers] could not store the catalogue:", cause);
  }
}

async function download(): Promise<WallpaperCatalogue | null> {
  try {
    const response = await fetch(new URL("/v1/wallpapers", apiUrl()), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`the catalogue answered ${response.status}`);

    const catalogue = (await response.json()) as WallpaperCatalogue;
    if (!catalogue?.palettes?.length || !catalogue.styles?.length) {
      throw new Error("the catalogue was empty");
    }

    await store(catalogue);
    log(
      "info",
      `wallpapers: ${catalogue.styles.length} styles, ${catalogue.palettes.length} palettes`,
    );
    return catalogue;
  } catch (cause) {
    console.warn("[wallpapers] could not fetch the catalogue:", cause);
    return null;
  }
}

/**
 * The catalogue, from disk if there is one and from the network otherwise.
 *
 * Stale-while-revalidate, like the picture catalogue: a stored list is
 * returned at once and a refresh runs behind it. Null means the caller should
 * use what the app ships, which here is the whole feature rather than a floor.
 */
export async function wallpapers(): Promise<WallpaperCatalogue | null> {
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
 * Puts a drawn background inside a recording, so it can be composited and
 * exported.
 *
 * Into the recording rather than a cache, which is what every other background
 * does and for the same reason: a recording that carries its own background
 * exports the same video on another machine, and next year — by which time the
 * palette it was drawn in may have been edited or taken away.
 */
export async function writeWallpaper(
  dir: string,
  file: string,
  bytes: ArrayBuffer,
): Promise<boolean> {
  if (!DRAWN.test(file)) return false;

  try {
    await mkdir(dir, { recursive: true });
    const destination = join(dir, file);

    // Already drawn. The name carries the recipe, the catalogue version and the
    // size, so a file of this name is this picture — there is nothing a second
    // rasterise could produce that is different. Without this, every open of a
    // recording with a drawn background re-wrote a few megabytes of PNG.
    try {
      await access(destination);
      return true;
    } catch {
      // Not there, which is the ordinary case the first time.
    }

    // Written beside and renamed, because the preview starts reading this the
    // moment the setting changes: a half-written PNG is a frame that draws
    // nothing and a composition that looks broken.
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, Buffer.from(bytes));
    await rename(temporary, destination);
    return true;
  } catch (cause) {
    console.warn(`[wallpapers] could not write ${file}:`, cause);
    return false;
  }
}
