/**
 * The gallery's stand-in for `prequel-media://`.
 *
 * The renderer reaches a recording through a scheme only Electron serves. In a
 * browser the same code asks for `/media/...` instead — `gallery/media-url.ts`
 * is swapped in for `shared/media-url.ts` by the Vite config — and this
 * middleware answers from the same places main would: the recording directory,
 * the app's own resources, and the caches under Application Support.
 *
 * Mirrors `src/main/media-protocol.ts` host by host rather than importing it:
 * that module imports `electron` at the top and cannot load in Node. The range
 * handling is copied for the same reason it exists there — without a `206`,
 * Chromium cannot seek a video, and the timeline's filmstrip is nothing but
 * seeks.
 *
 * Nothing here writes into the user's recording. Caption bitmaps the editor
 * asks to have written land in an overlay directory, which is read first, so
 * the fixture recording's own files keep their mtimes.
 */
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, ViteDevServer } from "vite";

export interface GalleryOptions {
  /** `~/Movies/Prequel/.recordings`, where the app writes takes. */
  recordings: string;
  /** `~/Library/Application Support/Prequel`, for the caches. */
  userData: string;
  /** Where files the editor asks to write land, instead of the recording. */
  overlay: string;
  /** The recording every editor shot opens. */
  recording: string;
}

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function optionsFromEnv(): GalleryOptions {
  const env = process.env;
  return {
    recordings: env.PREQUEL_GALLERY_RECORDINGS ?? join(homedir(), "Movies/Prequel/.recordings"),
    userData:
      env.PREQUEL_GALLERY_USERDATA ?? join(homedir(), "Library/Application Support/Prequel"),
    overlay: env.PREQUEL_GALLERY_OVERLAY ?? join(tmpdir(), "prequel-gallery"),
    recording: env.PREQUEL_GALLERY_RECORDING ?? "",
  };
}

/** Only what a session directory can legitimately contain. */
const ALLOWED = /\.(mp4|m4a|gif|png|jpg|jpeg)$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
} as const;

function contentType(path: string): string {
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".m4a")) return "audio/mp4";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".json")) return "application/json";
  return "image/jpeg";
}

/** `resolve` then compare — a `..` only shows itself once resolved. */
function inside(base: string, path: string): boolean {
  const root = resolve(base);
  const target = resolve(path);
  return target === root || target.startsWith(root + sep);
}

function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
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
 * Where a `/media/...` path lives on disk, or null.
 *
 * Segments are split before they are decoded, exactly as the protocol handler
 * does: a caption bitmap is named `captions%2F<hash>.png` — one segment with an
 * encoded slash in it — and decoding first would turn it into two.
 */
function resolveMedia(pathname: string, options: GalleryOptions): string | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [host, ...rest] = parts;

  if (host === "recording") {
    if (rest.length !== 2) return null;
    const [name, file] = rest as [string, string];
    if (!ALLOWED.test(file)) return null;
    // The overlay first: it holds what the editor wrote during this run, and
    // the recording holds what the app wrote before it.
    for (const root of [options.overlay, options.recordings]) {
      const path = join(root, name, file);
      if (inside(root, path) && existsSync(path)) return path;
    }
    // Cursor images are copied into a recording when the app opens it. One
    // the fixture never had comes from the bundle, as it would.
    const shipped = join(PACKAGE_ROOT, "resources", file);
    if (/^cursor-[a-z-]+\.png$/.test(file) && existsSync(shipped)) return shipped;
    const background = join(PACKAGE_ROOT, "resources/backgrounds", file);
    if (existsSync(background)) return background;
    return null;
  }

  if (host === "asset") {
    if (rest.length !== 1) return null;
    const [file] = rest as [string];
    if (file === "app-icon.png") return join(PACKAGE_ROOT, "resources/app-icon.png");
    const icon = /^permission-([a-z]+)\.png$/.exec(file);
    if (icon) return join(PACKAGE_ROOT, "resources/permissions", `${icon[1]}.png`);
    const background = join(PACKAGE_ROOT, "resources/backgrounds", file);
    return inside(join(PACKAGE_ROOT, "resources/backgrounds"), background) ? background : null;
  }

  if (host === "background") {
    if (rest.length !== 1) return null;
    const root = join(options.userData, "backgrounds/thumbnails");
    const path = join(root, rest[0]!);
    return inside(root, path) ? path : null;
  }

  if (host === "scene-preset") {
    if (rest.length !== 2 || rest[0] !== "mine") return null;
    const root = join(options.userData, "scene-presets");
    const path = join(root, rest[1]!, "card.jpg");
    return inside(root, path) ? path : null;
  }

  // A finished export. The gallery never renders one, so the recording's own
  // screen track stands in for the file the dialog would play back.
  if (host === "export") {
    return join(options.recordings, options.recording, "screen.mp4");
  }

  return null;
}

/**
 * The fixture endpoints: the JSON the bridge needs to build an `EditorSession`
 * and the library grid, read straight off disk.
 */
function fixture(pathname: string, options: GalleryOptions): unknown | null {
  if (pathname === "/fixture/config.json") {
    return { recording: options.recording, recordingsDir: options.recordings };
  }

  const file = /^\/fixture\/recording\/([^/]+)\/(session|project|transcript)\.json$/.exec(pathname);
  if (file) {
    const path = join(options.recordings, decodeURIComponent(file[1]!), `${file[2]}.json`);
    if (!inside(options.recordings, path) || !existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  }

  if (pathname === "/fixture/recordings.json") {
    // Only recordings with a poster: the grid makes missing posters itself,
    // which is a seek per card and a screenshot that never settles.
    if (!existsSync(options.recordings)) return [];
    return readdirSync(options.recordings)
      .filter((name) => existsSync(join(options.recordings, name, "poster.jpg")))
      .map((name) => {
        const dir = join(options.recordings, name);
        let title = name;
        try {
          const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
          if (typeof project.name === "string" && project.name) title = project.name;
        } catch {
          // No project yet: the folder's own name, as the app shows it.
        }
        const manifest = join(dir, "session.json");
        const createdAt = existsSync(manifest) ? statSync(manifest).mtimeMs : 0;
        const media = (file: string) =>
          `/media/recording/${encodeURIComponent(name)}/${encodeURIComponent(file)}`;
        return {
          dir,
          name: title,
          createdAt,
          poster: media("poster.jpg"),
          filmstrip: existsSync(join(dir, "filmstrip.jpg")) ? media("filmstrip.jpg") : null,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  if (pathname === "/fixture/backgrounds.json") {
    const path = join(options.userData, "backgrounds/catalogue.json");
    if (!existsSync(path)) return null;
    // The cache wraps the catalogue with the time it was fetched.
    return JSON.parse(readFileSync(path, "utf8")).catalogue ?? null;
  }

  if (pathname === "/fixture/scene-presets.json") {
    const path = join(options.userData, "scene-presets/presets.json");
    if (!existsSync(path)) return { version: 1, presets: [] };
    return JSON.parse(readFileSync(path, "utf8"));
  }

  return null;
}

export function mediaServer(options: GalleryOptions): Plugin {
  return {
    name: "prequel-gallery-media",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://gallery");
        const { pathname } = url;

        if (pathname.startsWith("/fixture/")) {
          const body = fixture(pathname, options);
          if (body === null) {
            res.writeHead(404).end("Not found");
            return;
          }
          res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
          return;
        }

        // What the editor writes: caption bitmaps, and nothing else. Into the
        // overlay, never the recording — the shot must not leave a trace in
        // the user's take.
        if (pathname.startsWith("/overlay/") && req.method === "PUT") {
          const parts = pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
          if (parts.length !== 2) {
            res.writeHead(400).end();
            return;
          }
          const path = join(options.overlay, parts[0]!, parts[1]!);
          if (!inside(options.overlay, path)) {
            res.writeHead(400).end();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, Buffer.concat(chunks));
            res.writeHead(200, CORS).end();
          });
          return;
        }

        if (!pathname.startsWith("/media/")) {
          next();
          return;
        }

        const path = resolveMedia(pathname.slice("/media".length), options);
        if (!path || !existsSync(path)) {
          res.writeHead(404, CORS).end("Not found");
          return;
        }

        const { size } = statSync(path);
        const headers: Record<string, string> = {
          ...CORS,
          "Content-Type": contentType(path),
          "Accept-Ranges": "bytes",
        };

        if (req.method === "HEAD") {
          res.writeHead(200, { ...headers, "Content-Length": String(size) }).end();
          return;
        }

        const range = parseRange(req.headers.range, size);
        if (!range) {
          res.writeHead(200, { ...headers, "Content-Length": String(size) });
          createReadStream(path).pipe(res);
          return;
        }

        const { start, end } = range;
        res.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        });
        createReadStream(path, { start, end }).pipe(res);
      });
    },
  };
}

/** For the console line the config prints, so a wrong path is obvious. */
export function describe(options: GalleryOptions): string {
  return `recording "${options.recording}" from ${options.recordings} (${basename(options.userData)} caches)`;
}
