/**
 * The background catalogue, and the pictures in it.
 *
 * `scripts/upload-backgrounds.ts` writes all three objects into R2; this reads
 * them back out. The app used to carry forty megabytes of JPEGs in its bundle
 * for a picker most people touch once.
 *
 * Bytes are served through the Worker rather than as presigned URLs, which is
 * the opposite of what `videos.ts` does — and for the opposite reason. A video
 * is hundreds of megabytes to one viewer, so it must not pass through here. A
 * thumbnail is twenty kilobytes to everyone, and a URL that never expires is
 * one the desktop app can cache on disk and re-check with `If-None-Match`
 * rather than re-minting on every launch.
 *
 * Nothing here is authenticated. A picker that only works once somebody signs
 * in is a picker that mostly does not work.
 */
import { Hono } from "hono";

import type { Env } from "../env.ts";
import {
  BACKGROUNDS_CONFIG_KEY,
  BACKGROUNDS_RAW_PREFIX,
  BACKGROUNDS_THUMBNAIL_PREFIX,
  backgroundsConfig,
} from "../lib/backgrounds.ts";

const backgrounds = new Hono<{ Bindings: Env }>();

/**
 * A day for the catalogue.
 *
 * It changes when somebody uploads a picture, which is rare, and the app
 * re-checks in the background anyway. `stale-while-revalidate` is what lets a
 * cold edge serve yesterday's list instantly rather than waiting on R2.
 */
const CATALOGUE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

/**
 * A year for the pictures.
 *
 * Safe because a picture is never edited in place: the file name is what a
 * project stores, so changing one means adding a new name. See the skill.
 */
const PICTURE_CACHE = "public, max-age=31536000, immutable";

/** Rejects anything that is not a bare file name — no slashes, no traversal. */
function pictureKey(prefix: string, file: string): string | null {
  return /^[a-z0-9][a-z0-9-]*\.jpg$/i.test(file) ? `${prefix}/${file}` : null;
}

async function picture(env: Env, key: string | null, header: string | null): Promise<Response> {
  if (!key) return new Response("not found", { status: 404 });

  // `If-None-Match` carries the tag quoted, and a weak one carries a `W/` too.
  // R2 wants it bare and *throws* on the quoted form — "Conditional ETag should
  // not be wrapped in quotes", which surfaces as a 500 on what should be the
  // cheapest request the app makes.
  const etag = header?.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;

  // `onlyIf` lets R2 answer the conditional request itself, so an unchanged
  // picture costs a metadata read rather than a body.
  const object = await env.MEDIA.get(
    key,
    etag ? { onlyIf: { etagDoesNotMatch: etag } } : undefined,
  );
  if (!object) return new Response("not found", { status: 404 });

  const headers = new Headers({
    "cache-control": PICTURE_CACHE,
    etag: object.httpEtag,
  });

  // A body only comes back when the etag did not match; without one this is a
  // 304 and the caller keeps what it has.
  if (!("body" in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("content-type", object.httpMetadata?.contentType ?? "image/jpeg");
  return new Response(object.body, { headers });
}

/**
 * The catalogue.
 *
 * Validated on the way out as well as on the way in. The schema is the only
 * thing standing between a bad upload and every editor showing an empty
 * picker, and failing here is the version of that which is visible.
 */
backgrounds.get("/", async (c) => {
  const object = await c.env.MEDIA.get(BACKGROUNDS_CONFIG_KEY);
  if (!object) return c.json({ message: "No background catalogue has been uploaded." }, 404);

  const parsed = backgroundsConfig.safeParse(await object.json());
  if (!parsed.success) {
    console.error("background catalogue did not parse", parsed.error.message);
    return c.json({ message: "The background catalogue is not readable." }, 500);
  }

  // The app is handed paths rather than building them, so the layout of the
  // bucket stays this Worker's business.
  const body = {
    ...parsed.data,
    backgrounds: parsed.data.backgrounds.map((entry) => ({
      ...entry,
      thumbnail: `/v1/backgrounds/thumbnail/${entry.file}`,
      raw: `/v1/backgrounds/raw/${entry.file}`,
    })),
  };

  c.header("cache-control", CATALOGUE_CACHE);
  return c.json(body);
});

backgrounds.get("/thumbnail/:file", (c) =>
  picture(
    c.env,
    pictureKey(BACKGROUNDS_THUMBNAIL_PREFIX, c.req.param("file")),
    c.req.header("if-none-match") ?? null,
  ),
);

backgrounds.get("/raw/:file", (c) =>
  picture(
    c.env,
    pictureKey(BACKGROUNDS_RAW_PREFIX, c.req.param("file")),
    c.req.header("if-none-match") ?? null,
  ),
);

export default backgrounds;
