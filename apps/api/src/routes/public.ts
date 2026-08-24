/**
 * What a share link resolves to.
 *
 * No authentication of any kind. A Prequel link is unlisted-public by design —
 * it goes in a chat window to somebody who does not have an account and is not
 * going to make one — so the only thing between a stranger and the video is the
 * 94 bits of entropy in the slug.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "@prequel/db";

import { database } from "../db.ts";
import type { Env } from "../env.ts";
import { signedPlayback } from "../lib/r2.ts";

const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get("/:slug", async (c) => {
  const db = database(c.env);

  const [row] = await db
    .select({
      id: schema.video.id,
      slug: schema.video.slug,
      title: schema.video.title,
      contentType: schema.video.contentType,
      durationMs: schema.video.durationMs,
      width: schema.video.width,
      height: schema.video.height,
      objectKey: schema.video.objectKey,
      posterKey: schema.video.posterKey,
      createdAt: schema.video.createdAt,
      deletedAt: schema.video.deletedAt,
      status: schema.video.status,
      teamName: schema.organization.name,
    })
    .from(schema.video)
    .leftJoin(schema.organization, eq(schema.video.teamId, schema.organization.id))
    .where(eq(schema.video.slug, c.req.param("slug")))
    .limit(1);

  if (!row || row.status !== "ready") return c.json({ message: "No such recording." }, 404);

  // A deleted recording answers 410 rather than 404. The row is kept precisely
  // so the page can say "this was deleted" instead of showing the site's
  // not-found page, which reads as the link never having worked.
  if (row.deletedAt)
    return c.json({ message: "This recording was deleted.", code: "DELETED" }, 410);

  // After the response is committed, so a view never costs the visitor a
  // round-trip and a D1 hiccup cannot stop the video from playing.
  c.executionCtx.waitUntil(
    db
      .update(schema.video)
      .set({ viewCount: sql`${schema.video.viewCount} + 1` })
      .where(and(eq(schema.video.id, row.id), isNull(schema.video.deletedAt))),
  );

  return c.json({
    title: row.title,
    contentType: row.contentType,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    teamName: row.teamName,
    createdAt: row.createdAt,
    src: await signedPlayback(c.env, row.objectKey),
    // A stable URL, not a signed one — see the handler below.
    poster: row.posterKey ? `${c.env.API_URL}/p/${row.slug}/poster` : null,
  });
});

/**
 * The still, served rather than signed.
 *
 * Every other object in this bucket is handed out as a presigned URL, and the
 * poster deliberately is not. Two reasons, and the first is the one that
 * matters:
 *
 * **A share card outlives a signature.** This URL goes into `og:image`, and
 * Slack, iMessage and the rest keep what they scrape. A six-hour signature means
 * a link pasted on Friday shows a broken picture by Saturday — with nothing
 * failing at the time to suggest it would.
 *
 * **A poster is cheap to proxy and a video is not.** Presigned URLs exist here
 * because a Worker cannot stand in front of hundreds of megabytes of video. A
 * 50 KB JPEG is a different problem, and paying one Worker invocation for it
 * buys a URL that does not expire.
 *
 * Nothing is given away by this. The still is one frame of a recording that
 * anybody holding the link can already watch in full, and the slug protecting it
 * is the same unguessable string protecting the video. Deleting the recording
 * removes the object, so this answers 404 from then on.
 */
publicRoutes.get("/:slug/poster", async (c) => {
  const db = database(c.env);

  const [row] = await db
    .select({ posterKey: schema.video.posterKey, deletedAt: schema.video.deletedAt })
    .from(schema.video)
    .where(eq(schema.video.slug, c.req.param("slug")))
    .limit(1);

  if (!row?.posterKey || row.deletedAt) return c.notFound();

  const object = await c.env.MEDIA.get(row.posterKey);
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/jpeg",
      "content-length": String(object.size),
      // An hour. Long enough that a scrape and the grid renders that follow are
      // one fetch, short enough that deleting a recording takes its picture out
      // of circulation the same afternoon. `immutable` would be true of the
      // bytes and wrong about the permission.
      "cache-control": "public, max-age=3600",
    },
  });
});

export default publicRoutes;
