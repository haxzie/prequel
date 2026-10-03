/**
 * The record of every export this Mac has written.
 *
 * A ledger rather than a folder scan, because there is no folder to scan: an
 * export goes wherever the save dialog pointed — Downloads, the Desktop, a
 * drive that is not plugged in this week — and once it is written nothing about
 * the file says it came from here. So the only moment the fact exists is the
 * moment main finishes writing one, and this is where it is kept.
 *
 * The path is all that is stored. Size comes from a `stat` on every listing and
 * the thumbnail from a cache keyed by id, so a file that has been re-exported
 * over, moved or deleted corrects itself rather than being remembered wrongly.
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

import { homedir } from "node:os";

import { app, nativeImage, shell, type WebContents } from "electron";

import type { ExportSummary } from "../shared/contract.js";
import { isImageExport } from "../shared/contract.js";
import { exportThumbnailUrl, exportUrl } from "../shared/media-url.js";

const LEDGER_FILE = "exports.json";

/**
 * How many exports are remembered.
 *
 * Generous, because an entry is a path and a number and the pane pages through
 * nothing — but not unbounded: this file is read whole on every listing and on
 * every media request that misses the in-memory registry, and somebody who
 * exports daily for three years should not be paying for the first of them.
 */
const LIMIT = 500;

/** One row of the ledger. Deliberately the least that can be stored. */
interface Entry {
  path: string;
  /** Epoch milliseconds when the export finished. */
  at: number;
  /**
   * How long the file runs, in milliseconds.
   *
   * Stored rather than measured, because measuring it means decoding the file
   * and main cannot: there is no `ffprobe` to lean on in a packaged app, and
   * the one process here that can open a video is the renderer. The exporter
   * already knows the answer exactly — it is the frames it wrote over the rate
   * it wrote them at — so it is written down at the one moment it is free.
   *
   * Absent on any export recorded before this was kept.
   */
  ms?: number;
}

/**
 * The file's name for a path, and the only key anything here is identified by.
 *
 * A hash rather than the basename. Exports are named for the moment they were
 * written, but the save sheet lets that be typed over, so two exports sharing a
 * basename in two different folders is ordinary — and the media route would
 * then serve whichever was registered last for both. A hash of the full path
 * cannot collide between two files that exist at once.
 *
 * Sixteen hex characters of SHA-1: short enough to read in a URL, far past the
 * point where a few hundred paths could collide.
 */
export function exportId(path: string): string {
  return createHash("sha1").update(path).digest("hex").slice(0, 16);
}

function ledgerPath(): string {
  return join(app.getPath("userData"), LEDGER_FILE);
}

/** Where the cached stills live. Never beside the export — see `media-url.ts`. */
function thumbnailDir(): string {
  return join(app.getPath("userData"), "exports");
}

/**
 * The cached still for one id, as the media protocol serves it.
 *
 * Bare ids only, matched against the shape `exportId` produces: the renderer
 * supplies this segment, and an id that is not one of ours is not a path to be
 * cleaned up, it is a request for something that does not exist.
 */
const BARE_THUMBNAIL = /^([0-9a-f]{16})\.jpg$/;

export function exportThumbnailPath(fileName: string): string | null {
  const match = BARE_THUMBNAIL.exec(fileName);
  return match ? join(thumbnailDir(), fileName) : null;
}

/**
 * Held for the life of the process as well as on disk.
 *
 * The media protocol reaches in here on every range request for an export —
 * which is every seek of the thumbnail the pane is playing — and re-reading and
 * re-parsing the ledger for each of those would put the file on the main
 * process's event loop in a tight loop.
 */
let memory: Entry[] | null = null;

function read(): Entry[] {
  if (memory) return memory;

  try {
    const stored = JSON.parse(readFileSync(ledgerPath(), "utf8")) as { exports?: unknown };
    // Shape-checked rather than trusted: this file is on the user's disk, and a
    // half-written one reaching the pane as a row with no path is a row that
    // fails on click with nothing to say why.
    memory = Array.isArray(stored.exports)
      ? stored.exports.filter(
          (entry): entry is Entry =>
            typeof (entry as Entry | null)?.path === "string" &&
            typeof (entry as Entry).at === "number",
        )
      : [];
  } catch {
    // No file yet, or an unreadable one. An empty ledger is the right answer to
    // both — there is nothing here worth recovering.
    memory = [];
  }

  return memory;
}

function write(entries: Entry[]): void {
  memory = entries;

  try {
    writeFileSync(ledgerPath(), JSON.stringify({ exports: entries }, null, 2), "utf8");
  } catch (cause) {
    // Losing the record of an export is not worth failing the export over. The
    // file itself is written and the user has been shown where it went; all
    // that is lost is the row in the pane.
    console.warn("[exports] could not record the export:", cause);
  }
}

/**
 * Notes a finished export.
 *
 * Called once the file exists, from the one place that knows it does. Exporting
 * twice to the same path — a re-export over an earlier attempt, which the save
 * sheet's overwrite confirmation exists for — replaces the entry rather than
 * adding a second, and the cached still for it is dropped so the pane takes a
 * new one of the new file.
 */
export function recordExport(path: string, durationMs: number | null, at = Date.now()): void {
  const kept = read().filter((entry) => entry.path !== path);
  forgetThumbnail(path);
  write(
    [{ path, at, ...(durationMs === null ? {} : { ms: durationMs }) }, ...kept].slice(0, LIMIT),
  );
}

/**
 * Every export still on disk, newest first.
 *
 * Entries whose file has gone are dropped here rather than shown greyed out.
 * An export is a file the user was handed and then did what they liked with —
 * moved it, sent it, deleted it — and a list of things that are not there is a
 * list nobody can act on.
 */
export function listExports(): ExportSummary[] {
  const entries = read();
  const summaries: ExportSummary[] = [];
  const alive: Entry[] = [];

  for (const entry of entries) {
    let bytes: number;
    try {
      bytes = statSync(entry.path).size;
    } catch {
      continue;
    }

    alive.push(entry);

    const id = exportId(entry.path);
    const name = basename(entry.path);
    summaries.push({
      path: entry.path,
      name,
      folder: abbreviate(dirname(entry.path)),
      createdAt: entry.at,
      // Only a number that could be a length. A hand-edited file, or one from
      // a build that wrote something else here, must not reach the table as
      // `NaN:aN`.
      durationMs: typeof entry.ms === "number" && entry.ms > 0 ? entry.ms : null,
      bytes,
      isImage: isImageExport(name),
      url: exportUrl(id, name),
      thumbnail: existsSync(join(thumbnailDir(), `${id}.jpg`)) ? exportThumbnailUrl(id) : null,
    });
  }

  // Only when something actually went, so an ordinary listing is reads alone.
  if (alive.length !== entries.length) write(alive);

  return summaries;
}

/**
 * A folder as a Mac writes one: `~/Downloads`, not `/Users/you/Downloads`.
 *
 * The home directory is half the width of the column and the same on every
 * row, so spelling it out would push the part that differs off the end.
 */
function abbreviate(folder: string): string {
  const home = homedir();
  return folder === home
    ? "~"
    : folder.startsWith(home + "/")
      ? `~${folder.slice(home.length)}`
      : folder;
}

/**
 * The file one id names, or null.
 *
 * How the media protocol reaches an export written by a previous run: its own
 * registry only holds what this run wrote, and the pane shows everything.
 */
export function exportPath(id: string): string | null {
  return read().find((entry) => exportId(entry.path) === id)?.path ?? null;
}

/**
 * Opens an export in whatever the Mac plays it with.
 *
 * Only a path in the ledger. The renderer hands this back from a row it was
 * given, so it is already ours — but this is `shell.openPath` reached from a
 * click, and the cost of being sure is one lookup.
 */
export async function openExport(path: string): Promise<void> {
  if (!read().some((entry) => entry.path === path)) {
    console.warn(`[exports] refusing to open a path that is not a recorded export: ${path}`);
    return;
  }

  const error = await shell.openPath(path);
  if (error) console.warn(`[exports] could not open ${path}: ${error}`);
}

/**
 * Caches a still the pane has just made.
 *
 * The renderer is the only process here that can decode video, so the pane
 * takes its own frame and hands it back — the same arrangement the Projects
 * grid has with its posters, and the same two guards: a path that is not a
 * recorded export, and anything that is not a JPEG data URL, are refused rather
 * than written. Whatever `Buffer.from` made of a non-image would be served back
 * as one.
 */
export function saveExportThumbnail(path: string, dataUrl: string): void {
  if (!read().some((entry) => entry.path === path)) {
    console.warn(`[exports] refusing a still for a path that is not a recorded export: ${path}`);
    return;
  }

  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/jpeg;base64,") || comma === -1) {
    console.warn(`[exports] refusing a still for ${path} that is not a JPEG data URL`);
    return;
  }

  try {
    mkdirSync(thumbnailDir(), { recursive: true });
    writeFileSync(
      join(thumbnailDir(), `${exportId(path)}.jpg`),
      Buffer.from(dataUrl.slice(comma + 1), "base64"),
    );
  } catch (cause) {
    // A row without a picture, which is worse-looking rather than broken — and
    // the next time the pane opens it simply tries again.
    console.warn(`[exports] could not cache a still for ${path}:`, cause);
  }
}

/**
 * Hands a listed export to a native drag.
 *
 * The icon is read here rather than sent with the drag, which is the one thing
 * this does differently from the export dialog's version. That dialog is
 * already showing the finished file and can hand over the frame under the
 * pointer; the pane only ever holds a `prequel-media:` URL for a still it does
 * not have the bytes of, and Electron wants an image.
 *
 * A drag with no image is refused rather than started. Electron throws on an
 * empty one, and a drag whose icon is a blank pixel reads as nothing having
 * been picked up — the row is dragged again, and again, with no way to tell
 * that anything happened.
 */
export function dragExport(sender: WebContents, path: string): void {
  if (!read().some((entry) => entry.path === path)) {
    console.warn(`[exports] refusing to drag a path that is not a recorded export: ${path}`);
    return;
  }

  const icon = nativeImage.createFromPath(join(thumbnailDir(), `${exportId(path)}.jpg`));
  if (icon.isEmpty()) {
    console.warn("[exports] drag skipped: there is no cached still to drag with");
    return;
  }

  // Scaled here for the reason the dialog's drag scales: a full-size frame
  // under the pointer covers the window being dropped onto.
  sender.startDrag({ file: path, icon: icon.resize({ width: 160 }) });
}

/** Drops the cached still for a path, so the next listing takes a fresh one. */
function forgetThumbnail(path: string): void {
  try {
    unlinkSync(join(thumbnailDir(), `${exportId(path)}.jpg`));
  } catch {
    // There was none, which is the usual case.
  }
}
