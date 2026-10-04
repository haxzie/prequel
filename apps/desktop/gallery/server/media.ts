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

import { STILL_FILE_NAME } from "../../src/shared/manifest";

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

  // The repo's own `fonts/`, flattened the way the bucket flattens it: the app
  // asks for `inter-400.woff2` and the folder holds `inter/400.woff2`. Resolved
  // against the listing rather than by splitting on the last hyphen, because a
  // family id has hyphens of its own — `instrument-serif-400.woff2` splits two
  // ways and only one of them is a file.
  if (host === "font") {
    if (rest.length !== 1) return null;
    const [file] = rest as [string];
    const root = join(PACKAGE_ROOT, "../../fonts");

    for (const family of fontFamilies(root)) {
      if (!file.startsWith(`${family}-`)) continue;
      const path = join(root, family, file.slice(family.length + 1));
      if (inside(root, path) && existsSync(path)) return path;
    }
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

  // And its cached still, which the same recording's poster stands in for.
  if (host === "export-thumb") {
    return join(options.recordings, options.recording, "poster.jpg");
  }

  return null;
}

/**
 * The font family ids in the repo's listing, or none when there is no listing.
 *
 * Read per request rather than held: the gallery runs against a working tree
 * where a family is added by dropping a folder in, and a cached list would
 * serve a 404 for it until the server was restarted.
 */
function fontFamilies(root: string): string[] {
  try {
    const listing = JSON.parse(readFileSync(join(root, "families.json"), "utf8")) as {
      families: { id: string }[];
    };
    return listing.families.map((family) => family.id);
  } catch {
    return [];
  }
}

/** `freshPoster` from `main/projects.ts`: is the still older than the edit? */
function fresh(dir: string): boolean {
  try {
    const poster = statSync(join(dir, "poster.jpg")).mtimeMs;
    return poster >= statSync(join(dir, "project.json")).mtimeMs;
  } catch {
    // No `project.json`: nobody has edited this recording, and its still is as
    // current as it will ever be.
    return true;
  }
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

  // The catalogue the Worker would serve, built from the working tree. The
  // gallery has no R2 and no API; what it has is the same files, and a picker
  // drawn against them is the one way to see a face before it is uploaded.
  if (pathname === "/fixture/fonts.json") {
    const root = join(PACKAGE_ROOT, "../../fonts");
    const listingPath = join(root, "families.json");
    if (!existsSync(listingPath)) return null;

    const listing = JSON.parse(readFileSync(listingPath, "utf8")) as {
      categories: { id: string; label: string }[];
      families: { id: string; label: string; category: string }[];
    };

    const families = listing.families.flatMap((family) => {
      const folder = join(root, family.id);
      if (!existsSync(folder)) return [];

      const variants = readdirSync(folder)
        .sort()
        .flatMap((file) => {
          const match = /^(\d{3})(-italic)?\.(woff2|woff|ttf|otf)$/i.exec(file);
          if (!match) return [];
          const italic = Boolean(match[2]);
          return [
            {
              weight: Number(match[1]),
              italic,
              file: `${family.id}-${match[1]!}${italic ? "-italic" : ""}.${match[3]!.toLowerCase()}`,
              md5: "0".repeat(32),
              bytes: statSync(join(folder, file)).size,
              url: "",
            },
          ];
        });

      return variants.length > 0 ? [{ ...family, variants }] : [];
    });

    return {
      version: 1,
      updated: new Date().toISOString(),
      categories: listing.categories,
      families,
    };
  }

  if (pathname === "/fixture/recordings.json") {
    // Only recordings with a poster: the grid makes missing posters itself,
    // which is a decode and a WebGL draw per card and a screenshot that never
    // settles.
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
        const project = join(dir, "project.json");
        const editedAt = existsSync(project) ? statSync(project).mtimeMs : null;
        const media = (file: string) =>
          `/media/recording/${encodeURIComponent(name)}/${encodeURIComponent(file)}`;
        return {
          dir,
          name: title,
          createdAt,
          editedAt,
          // Null once the edit is newer than the still, exactly as
          // `listProjects` reports it: the tile pictures the composition, so an
          // edit is a picture out of date. A fixture with a stale poster is
          // therefore a card that composes itself while the shot is taken.
          poster: fresh(dir) ? media("poster.jpg") : null,
          // The same one-stat test `listProjects` makes, so the two libraries
          // are split in the gallery exactly as they are in the app.
          still: existsSync(join(options.recordings, name, STILL_FILE_NAME)),
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
