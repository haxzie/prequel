/**
 * The font catalogue, and the files in it.
 *
 * `scripts/upload-fonts.ts` writes the objects into R2; this reads them back
 * out, the way `backgrounds.ts` does for pictures and for the same reasons: a
 * font file is a few hundred kilobytes to everyone, a URL that never expires
 * is one the desktop app can cache on disk, and nothing here is
 * authenticated because a picker that only works once somebody signs in is a
 * picker that mostly does not work.
 */
import { Hono } from "hono";

import type { Env } from "../env.ts";
import { FONTS_CONFIG_KEY, FONTS_FILE_PREFIX, fontsConfig } from "../lib/fonts.ts";

const fonts = new Hono<{ Bindings: Env }>();

/** A day for the catalogue; see `backgrounds.ts` for why. */
const CATALOGUE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

/** A year for the files. A file is never edited in place: a new face is a new
    name, and a project stores the name. */
const FILE_CACHE = "public, max-age=31536000, immutable";

const TYPES: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** Rejects anything that is not a bare font file name — no slashes, no traversal. */
function fileKey(file: string): { key: string; type: string } | null {
  const match = /^([a-z0-9][a-z0-9-]*)\.(woff2|woff|ttf|otf)$/i.exec(file);
  if (!match) return null;
  return { key: `${FONTS_FILE_PREFIX}/${file}`, type: TYPES[match[2]!.toLowerCase()]! };
}

fonts.get("/", async (c) => {
  const object = await c.env.MEDIA.get(FONTS_CONFIG_KEY);
  if (!object) return c.json({ message: "No font catalogue has been uploaded." }, 404);

  const parsed = fontsConfig.safeParse(await object.json());
  if (!parsed.success) {
    console.error("font catalogue did not parse", parsed.error.message);
    return c.json({ message: "The font catalogue is not readable." }, 500);
  }

  // The app is handed paths rather than building them, so the layout of the
  // bucket stays this Worker's business.
  const body = {
    ...parsed.data,
    families: parsed.data.families.map((family) => ({
      ...family,
      variants: family.variants.map((variant) => ({
        ...variant,
        url: `/v1/fonts/file/${variant.file}`,
      })),
    })),
  };

  c.header("cache-control", CATALOGUE_CACHE);
  return c.json(body);
});

fonts.get("/file/:file", async (c) => {
  const found = fileKey(c.req.param("file"));
  if (!found) return new Response("not found", { status: 404 });

  // Bare, for the reason `backgrounds.ts` gives: R2 throws on the quoted form.
  const etag =
    c.req.header("if-none-match")?.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;

  const object = await c.env.MEDIA.get(
    found.key,
    etag ? { onlyIf: { etagDoesNotMatch: etag } } : undefined,
  );
  if (!object) return new Response("not found", { status: 404 });

  const headers = new Headers({ "cache-control": FILE_CACHE, etag: object.httpEtag });
  if (!("body" in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("content-type", found.type);
  return new Response(object.body, { headers });
});

export default fonts;
