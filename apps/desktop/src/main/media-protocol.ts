/**
 * Serves recorded media to the editor's renderer.
 *
 * A renderer cannot read `file:` URLs — the CSP forbids it and sandboxed
 * renderers have no filesystem access — so the recordings are reached through a
 * scheme of our own. Two things about it are load-bearing:
 *
 * Range requests. Without a `206` for a `Range` header, Chromium cannot seek a
 * video: playback works for as long as the buffer lasts and then simply stops.
 * `net.fetch` over a `file:` URL is the one-line alternative and does not
 * reliably honour Range, which is why this reads the header itself.
 *
 * The traversal guard. The URL is entirely renderer-controlled, and the
 * renderer is the least-trusted process in the app. Every resolved path is
 * checked to be inside the recordings directory before anything is opened.
 */
import { createReadStream, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import { fileURLToPath } from "node:url";

import { protocol } from "electron";

import { BACKGROUND_PRESETS } from "../shared/backgrounds.js";
import { PERMISSION_IDS } from "../shared/contract.js";

import { MEDIA_SCHEME, mediaUrl as urlFor } from "../shared/media-url.js";
import { RECORDINGS_DIR } from "./session.js";

export { MEDIA_SCHEME } from "../shared/media-url.js";

/**
 * The URL for one file inside a recording directory.
 *
 * Takes a path where the shared builder takes a name, because everything in
 * main holds the full directory — and the URL must carry only the name, since
 * the handler resolves it against the recordings directory itself.
 */
export function mediaUrl(dir: string, fileName: string): string {
  return urlFor(basename(dir), fileName);
}

/**
 * Privileges the scheme needs, registered before `app.whenReady`.
 *
 * `stream` is the one that matters: without it Chromium will not issue range
 * requests at all, and a `<video>` cannot seek.
 */
export const MEDIA_SCHEME_PRIVILEGES = {
  scheme: MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
} as const;

/** Only what a session directory can legitimately contain. */
const ALLOWED = /\.(mp4|m4a|gif|png|jpg|jpeg)$/i;

/**
 * Resolves a media URL to a path inside the recordings directory.
 *
 * Returns null for anything outside it. `resolve` first, then compare: a name
 * like `../../..` only reveals itself as an escape once it has been resolved,
 * and comparing the raw string would let it through.
 */
export function resolveMediaPath(url: string, root = RECORDINGS_DIR): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const parts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  // The app's own shipped images — the background presets and their
  // thumbnails. Served from a fixed list rather than from a directory, so this
  // route has no path to traverse in the first place.
  if (parsed.host === "asset") {
    if (parts.length !== 1) return null;
    return assetPath(parts[0]!);
  }

  if (parts.length !== 2) return null;

  const [recording, fileName] = parts as [string, string];
  if (!ALLOWED.test(fileName)) return null;

  const path = resolve(join(root, recording, fileName));
  const base = resolve(root);
  // The separator matters: without it `/Movies/Prequel-evil` passes a plain
  // `startsWith` against `/Movies/Prequel`.
  if (path !== base && !path.startsWith(base + sep)) return null;

  return path;
}

/**
 * A shipped background, by file name.
 *
 * Matched against the preset list rather than sanitised: a name that is not one
 * of ours is not a path to be cleaned up, it is a request for something that
 * does not exist.
 */
/** The app's own icon, which the welcome window shows. */
const APP_ICON = "app-icon.png";

/**
 * `permission-camera.png` and its three siblings, which the welcome window's
 * permission rows show.
 *
 * Flat names for what is a directory on disk, because the asset route takes a
 * single path segment and nothing more — that is the whole reason it has
 * nothing to traverse. Widening it to two would buy a tidier URL and give this
 * handler a directory to be walked out of.
 */
const PERMISSION_ICON = /^permission-([a-z]+)\.png$/;

function assetPath(fileName: string): string | null {
  // Sits beside the backgrounds rather than in them, so it is served without
  // becoming something the background picker offers as a wallpaper.
  if (fileName === APP_ICON) {
    return fileURLToPath(new URL(`../../resources/${APP_ICON}`, import.meta.url));
  }

  // Matched against the permission ids for the same reason the backgrounds are
  // matched against the presets: an id that is not one of ours is not a name to
  // be sanitised, it is a request for a file that does not exist.
  const icon = PERMISSION_ICON.exec(fileName);
  if (icon) {
    const id = icon[1]!;
    if (!(PERMISSION_IDS as readonly string[]).includes(id)) return null;
    return fileURLToPath(new URL(`../../resources/permissions/${id}.png`, import.meta.url));
  }

  if (!BACKGROUND_PRESETS.some((preset) => preset.file === fileName)) return null;
  return fileURLToPath(new URL(`../../resources/backgrounds/${fileName}`, import.meta.url));
}

/** Parses a `Range` header of the form `bytes=start-end`. */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  // `bytes=-500` means the last 500 bytes, not "up to byte 500".
  if (!rawStart) {
    if (!rawEnd) return null;
    const length = Math.min(Number(rawEnd), size);
    return length <= 0 ? null : { start: size - length, end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  if (start > end || start >= size) return null;

  return { start, end };
}

/**
 * What makes the media same-origin enough to be read, not just played.
 *
 * `prequel-media:` is a different origin from the renderer, and a media element
 * loaded cross-origin without CORS approval is *tainted*: it still plays, but
 * anything that reads its samples gets nothing. A tainted element routed
 * through `createMediaElementSource` outputs digital silence — the picture
 * plays, the transport runs, and there is no sound and no error anywhere. The
 * element also has to ask for CORS mode with `crossOrigin`; a header on its own
 * does nothing.
 *
 * `*` rather than the renderer's origin because there is no stable origin to
 * name — the renderer is `file:` when packaged and `http://localhost` in dev —
 * and the scheme is only reachable from inside this app in the first place.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  // Range responses are useless to a caller that cannot see how much it got.
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
} as const;

function contentType(path: string): string {
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".m4a")) return "audio/mp4";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

/** Serves one request. Exported so the routing can be tested without Electron. */
export function serveMedia(url: string, rangeHeader: string | null, root?: string): Response {
  const path = resolveMediaPath(url, root);
  if (!path) return new Response("Not found", { status: 404 });

  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    ...CORS,
    "Content-Type": contentType(path),
    // Advertised on every response, not just partial ones: Chromium looks for
    // it before it will attempt a range request at all.
    "Accept-Ranges": "bytes",
  };

  const range = parseRange(rangeHeader, size);
  if (!range) {
    return new Response(toWebStream(createReadStream(path)), {
      status: 200,
      headers: { ...headers, "Content-Length": String(size) },
    });
  }

  const { start, end } = range;
  return new Response(toWebStream(createReadStream(path, { start, end })), {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

function toWebStream(stream: ReturnType<typeof createReadStream>): ReadableStream {
  return Readable.toWeb(stream) as ReadableStream;
}

/** Registers the handler. Call inside `app.whenReady`. */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request.url, request.headers.get("Range")));
}
