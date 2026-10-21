/**
 * The music library, and the files in it.
 *
 * `scripts/upload-music.ts` writes both objects into R2; this reads them back.
 *
 * Bytes are served through the Worker rather than as presigned URLs, for the
 * reason the backgrounds are: a track is a couple of megabytes to everyone
 * rather than hundreds to one viewer, and a URL that never expires is one the
 * desktop app can re-check with `If-None-Match` instead of re-minting on every
 * launch.
 *
 * Nothing here is authenticated. A library that only works once somebody signs
 * in is a library that mostly does not work.
 */
import { Hono } from "hono";

import type { Env } from "../env.ts";
import { MUSIC_CONFIG_KEY, MUSIC_RAW_PREFIX, musicConfig } from "../lib/music.ts";

/** A day for the catalogue — it changes when somebody uploads a track. */
const CATALOGUE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

/**
 * A year for the audio.
 *
 * Safe because a track is never edited in place: the file name is what a
 * project stores, so changing one means adding a new name.
 */
const TRACK_CACHE = "public, max-age=31536000, immutable";

/** Rejects anything that is not a bare file name — no slashes, no traversal. */
function trackKey(file: string): string | null {
  return /^[a-z0-9][a-z0-9-]*\.m4a$/i.test(file) ? `${MUSIC_RAW_PREFIX}/${file}` : null;
}

const music = new Hono<{ Bindings: Env }>();

/**
 * The catalogue.
 *
 * Validated on the way out as well as on the way in. The schema is the only
 * thing standing between a bad upload and every editor showing an empty
 * picker, and failing here is the version of that which is visible.
 */
music.get("/", async (c) => {
  const object = await c.env.MEDIA.get(MUSIC_CONFIG_KEY);
  if (!object) return c.json({ message: "No music catalogue has been uploaded." }, 404);

  const parsed = musicConfig.safeParse(await object.json());
  if (!parsed.success) {
    console.error("music catalogue did not parse", parsed.error.message);
    return c.json({ message: "The music catalogue is not readable." }, 500);
  }

  // The app is handed paths rather than building them, so the layout of the
  // bucket stays this Worker's business.
  const body = {
    ...parsed.data,
    tracks: parsed.data.tracks.map((entry) => ({
      ...entry,
      raw: `/v1/music/raw/${entry.file}`,
    })),
  };

  c.header("cache-control", CATALOGUE_CACHE);
  return c.json(body);
});

music.get("/raw/:file", async (c) => {
  const key = trackKey(c.req.param("file"));
  if (!key) return new Response("not found", { status: 404 });

  // `If-None-Match` carries the tag quoted, and a weak one carries a `W/` too.
  // R2 wants it bare and *throws* on the quoted form — the same trap the
  // backgrounds route documents, which surfaces as a 500 on what should be the
  // cheapest request the app makes.
  const header = c.req.header("if-none-match") ?? null;
  const etag = header?.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;

  const object = await c.env.MEDIA.get(
    key,
    etag ? { onlyIf: { etagDoesNotMatch: etag } } : undefined,
  );
  if (!object) return new Response("not found", { status: 404 });

  const headers = new Headers({ "cache-control": TRACK_CACHE, etag: object.httpEtag });

  // A body only comes back when the etag did not match; without one this is a
  // 304 and the caller keeps what it has.
  if (!("body" in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("content-type", object.httpMetadata?.contentType ?? "audio/mp4");
  return new Response(object.body, { headers });
});

export default music;
