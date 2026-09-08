/**
 * The scene-preset catalogue, and the cards in it.
 *
 * `scripts/upload-scene-presets.ts` writes both into R2; this reads them back.
 * Structurally the backgrounds route with a different prefix, deliberately — the
 * question at review should be "why is this different", not "why is this the
 * same".
 *
 * Nothing here is authenticated, for the reason the backgrounds give: a picker
 * that only works once somebody signs in is a picker that mostly does not work.
 */
import { Hono } from "hono";

import type { Env } from "../env.ts";
import {
  SCENE_PRESETS_CONFIG_KEY,
  SCENE_PRESETS_THUMBNAIL_PREFIX,
  scenePresetsConfig,
} from "../lib/scene-presets.ts";

/**
 * A day for the catalogue.
 *
 * It changes when somebody publishes a look, which is rare, and the app
 * re-checks in the background anyway. `stale-while-revalidate` is what lets a
 * cold edge serve yesterday's list instantly rather than waiting on R2.
 */
const CATALOGUE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

/**
 * A year for the cards.
 *
 * Safe because a card is never edited in place: it is named for its preset's
 * id, and changing one means publishing a new id.
 */
const CARD_CACHE = "public, max-age=31536000, immutable";

/** Rejects anything that is not a bare file name — no slashes, no traversal. */
function cardKey(file: string): string | null {
  return /^[a-z0-9][a-z0-9-]*\.jpg$/i.test(file)
    ? `${SCENE_PRESETS_THUMBNAIL_PREFIX}/${file}`
    : null;
}

const scenePresets = new Hono<{ Bindings: Env }>();

/**
 * The catalogue.
 *
 * Validated on the way out as well as on the way in. The schema is the only
 * thing standing between a bad upload and every editor showing a short picker,
 * and failing here is the version of that which is visible.
 */
scenePresets.get("/", async (c) => {
  const object = await c.env.MEDIA.get(SCENE_PRESETS_CONFIG_KEY);
  if (!object) return c.json({ message: "No scene presets have been published." }, 404);

  const parsed = scenePresetsConfig.safeParse(await object.json());
  if (!parsed.success) {
    console.error("scene preset catalogue did not parse", parsed.error.message);
    return c.json({ message: "The scene preset catalogue is not readable." }, 500);
  }

  // The app is handed a path rather than building one, so the layout of the
  // bucket stays this Worker's business. `md5` is dropped on the way out: it is
  // for the uploader deciding what to skip, and means nothing to a picker.
  const body = {
    version: parsed.data.version,
    updated: parsed.data.updated,
    presets: parsed.data.presets.map(({ md5: _md5, ...preset }) => ({
      ...preset,
      thumbnail: `/v1/scene-presets/thumbnail/${preset.id}.jpg`,
    })),
  };

  c.header("cache-control", CATALOGUE_CACHE);
  return c.json(body);
});

scenePresets.get("/thumbnail/:file", async (c) => {
  const key = cardKey(c.req.param("file"));
  if (!key) return new Response("not found", { status: 404 });

  // `If-None-Match` carries the tag quoted, and a weak one carries a `W/` too.
  // R2 wants it bare and *throws* on the quoted form — "Conditional ETag should
  // not be wrapped in quotes", which surfaces as a 500 on what should be the
  // cheapest request the app makes.
  const etag =
    c.req.header("if-none-match")?.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;

  // `onlyIf` lets R2 answer the conditional request itself, so an unchanged card
  // costs a metadata read rather than a body.
  const object = await c.env.MEDIA.get(
    key,
    etag ? { onlyIf: { etagDoesNotMatch: etag } } : undefined,
  );
  if (!object) return new Response("not found", { status: 404 });

  const headers = new Headers({ "cache-control": CARD_CACHE, etag: object.httpEtag });

  // A body only comes back when the etag did not match; without one this is a
  // 304 and the caller keeps what it has.
  if (!("body" in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("content-type", object.httpMetadata?.contentType ?? "image/jpeg");
  return new Response(object.body, { headers });
});

export default scenePresets;
