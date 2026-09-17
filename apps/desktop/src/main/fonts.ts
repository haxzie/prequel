/**
 * The hosted font catalogue, and the files in it.
 *
 * `backgrounds.ts` for faces, and the same shape for the same reasons: the
 * renderer cannot reach `api.prequel.sh`, so the catalogue comes over IPC and
 * the files are read back through `prequel-media://font/`. The catalogue is
 * served from `userData` at once and re-checked behind, so the picker draws
 * on a train; a file, once fetched, is kept for ever — its name never changes
 * meaning, and a project set in it has to keep rendering the same way.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import type { FontsCatalogue } from "../shared/contract.js";
import { apiUrl } from "./api.js";
import { log } from "./log.js";
import { fetchInto, isFont, TIMEOUT_MS } from "./media-cache.js";

/** How long a stored catalogue is served without re-checking. */
const FRESH_MS = 6 * 60 * 60 * 1000;

/** Bare names only, so there is no path in a name and nothing to traverse. */
export const BARE_FONT = /^[a-z0-9][a-z0-9-]*\.(woff2|woff|ttf|otf)$/i;

function cacheDir(): string {
  return join(app.getPath("userData"), "fonts");
}

function cataloguePath(): string {
  return join(cacheDir(), "catalogue.json");
}

/** Where a downloaded font file lives. Bare names only; the API refuses others. */
export function fontPath(file: string): string | null {
  return BARE_FONT.test(file) ? join(cacheDir(), "files", file) : null;
}

interface Stored {
  fetched: number;
  catalogue: FontsCatalogue;
}

let memory: Stored | null = null;
let inFlight: Promise<FontsCatalogue | null> | null = null;

async function read(): Promise<Stored | null> {
  if (memory) return memory;

  try {
    const raw = await readFile(cataloguePath(), "utf8");
    const stored = JSON.parse(raw) as Stored;
    // Shape-checked rather than trusted, as the backgrounds catalogue is.
    if (!Array.isArray(stored?.catalogue?.families)) return null;
    memory = stored;
    return stored;
  } catch {
    return null;
  }
}

async function write(catalogue: FontsCatalogue): Promise<void> {
  const stored: Stored = { fetched: Date.now(), catalogue };
  memory = stored;

  try {
    await mkdir(cacheDir(), { recursive: true });
    const temporary = `${cataloguePath()}.tmp`;
    await writeFile(temporary, JSON.stringify(stored), "utf8");
    await rename(temporary, cataloguePath());
  } catch (cause) {
    console.warn("[fonts] could not store the catalogue:", cause);
  }
}

async function download(): Promise<FontsCatalogue | null> {
  try {
    const response = await fetch(new URL("/v1/fonts", apiUrl()), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`the catalogue answered ${String(response.status)}`);

    const catalogue = (await response.json()) as FontsCatalogue;
    if (!Array.isArray(catalogue?.families)) throw new Error("the catalogue had no families");

    await write(catalogue);
    log("info", `fonts: ${String(catalogue.families.length)} families in the catalogue`);
    return catalogue;
  } catch (cause) {
    console.warn("[fonts] could not fetch the catalogue:", cause);
    return null;
  }
}

/**
 * The catalogue, from disk if there is one and from the network otherwise.
 * Stale-while-revalidate, as `backgrounds.catalogue` is. Null means there is
 * nothing hosted to offer, and the picker shows the macOS faces alone.
 */
export async function catalogue(): Promise<FontsCatalogue | null> {
  const stored = await read();

  if (stored) {
    if (Date.now() - stored.fetched > FRESH_MS && !inFlight) {
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

/** Downloads a font file into the cache. Answers whether it is there now. */
export async function ensureFont(file: string): Promise<boolean> {
  const destination = fontPath(file);
  if (!destination) return false;
  return fetchInto(`/v1/fonts/file/${file}`, destination, isFont);
}
