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
    poster: row.posterKey ? await signedPlayback(c.env, row.posterKey) : null,
  });
});

export default publicRoutes;
