/**
 * The library, and the upload that fills it.
 *
 * The bytes never touch this Worker. `POST /v1/videos` hands back presigned PUT
 * URLs, the client uploads straight to R2, and `complete` verifies what landed.
 * That is not only a cost decision — a Worker's request body limit is 100 MB and
 * a two-minute 4K export is comfortably past it.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";
import { id, slug } from "../lib/ids.ts";
import { posterKey, signedPlayback, signedUpload, videoKey } from "../lib/r2.ts";
import { authenticate, requireTeam, type AppContext } from "../middleware.ts";

const videos = new Hono<AppContext>();

videos.use("*", authenticate, requireTeam);

const TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "image/gif": "gif",
};

const Create = z.object({
  title: z.string().min(1).max(200),
  contentType: z.enum(["video/mp4", "image/gif"]),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().default(0),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  /** Absent when there is no still. Its presence is what asks for an upload URL. */
  posterContentType: z.enum(["image/png", "image/jpeg"]).optional(),
});

/** The team's library, newest first. */
videos.get("/", async (c) => {
  const db = c.get("db");
  const teamId = c.get("identity").teamId!;

  const rows = await db
    .select({
      id: schema.video.id,
      slug: schema.video.slug,
      title: schema.video.title,
      contentType: schema.video.contentType,
      sizeBytes: schema.video.sizeBytes,
      durationMs: schema.video.durationMs,
      width: schema.video.width,
      height: schema.video.height,
      viewCount: schema.video.viewCount,
      createdAt: schema.video.createdAt,
      posterKey: schema.video.posterKey,
      ownerName: schema.user.name,
    })
    .from(schema.video)
    .leftJoin(schema.user, eq(schema.video.ownerId, schema.user.id))
    .where(
      and(
        eq(schema.video.teamId, teamId),
        eq(schema.video.status, "ready"),
        isNull(schema.video.deletedAt),
      ),
    )
    .orderBy(desc(schema.video.createdAt))
    .limit(200);

  // Posters are signed here rather than fetched per card from `/p/:slug`.
  // That endpoint counts a view, so a library page would register one for every
  // recording on it every time somebody opened the dashboard. Signing is a local
  // HMAC with no network in it, so doing it inline costs nothing worth avoiding.
  const videos = await Promise.all(
    rows.map(async ({ posterKey: key, ...row }) => ({
      ...row,
      poster: key ? await signedPlayback(c.env, key) : null,
    })),
  );

  return c.json({ videos, usage: await usage(c.get("db"), teamId) });
});

/**
 * Reserves a row and returns somewhere to put the bytes.
 *
 * The row exists before the upload starts because the presigned URL has to name
 * a key, and a key needs an id. Anything left at `uploading` is an abandoned
 * attempt: invisible in the library, and not counted against the quota below.
 */
videos.post("/", async (c) => {
  const db = c.get("db");
  const { userId, teamId } = c.get("identity");

  const parsed = Create.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That upload request isn't valid." }, 400);

  const body = parsed.data;

  const [team] = await db
    .select({ quota: schema.organization.storageQuotaBytes })
    .from(schema.organization)
    .where(eq(schema.organization.id, teamId!))
    .limit(1);

  const used = await usage(db, teamId!);
  if (team && used + body.sizeBytes > team.quota) {
    return c.json(
      { message: "This team is out of storage.", code: "QUOTA_EXCEEDED" },
      // 507, not 403: the request is allowed and well-formed, there is simply
      // nowhere to put it. The desktop app shows the two differently.
      507,
    );
  }

  const videoId = id("vid");
  const extension = TYPES[body.contentType] ?? "mp4";
  const key = videoKey(teamId!, videoId, extension);
  const poster = body.posterContentType
    ? posterKey(teamId!, videoId, body.posterContentType)
    : null;

  await db.insert(schema.video).values({
    id: videoId,
    slug: slug(),
    teamId: teamId!,
    ownerId: userId,
    title: body.title,
    status: "uploading",
    objectKey: key,
    posterKey: poster,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
    durationMs: body.durationMs,
    width: body.width,
    height: body.height,
  });

  return c.json({
    id: videoId,
    uploadUrl: await signedUpload(c.env, key, body.contentType),
    posterUploadUrl:
      poster && body.posterContentType
        ? await signedUpload(c.env, poster, body.posterContentType)
        : null,
  });
});

/**
 * Confirms the object arrived, and publishes the link.
 *
 * The HEAD is not a formality. `POST /v1/videos` checked the quota against a
 * size the *client* declared, and a client that declares 1 MB and uploads 4 GB
 * would otherwise walk straight past it. The size R2 reports is the one that
 * gets stored.
 */
videos.post("/:id/complete", async (c) => {
  const db = c.get("db");
  const { teamId } = c.get("identity");

  const [row] = await db
    .select()
    .from(schema.video)
    .where(and(eq(schema.video.id, c.req.param("id")), eq(schema.video.teamId, teamId!)))
    .limit(1);

  if (!row) return c.json({ message: "No such recording." }, 404);

  const object = await c.env.MEDIA.head(row.objectKey);

  if (!object) {
    await db
      .update(schema.video)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.video.id, row.id));

    return c.json({ message: "The upload didn't finish." }, 400);
  }

  await db
    .update(schema.video)
    .set({ status: "ready", sizeBytes: object.size, updatedAt: new Date() })
    .where(eq(schema.video.id, row.id));

  return c.json({ id: row.id, slug: row.slug, url: `${c.env.APP_URL}/v/${row.slug}` });
});

const Update = z.object({ title: z.string().min(1).max(200) });

videos.patch("/:id", async (c) => {
  const db = c.get("db");
  const parsed = Update.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That title isn't valid." }, 400);

  const updated = await db
    .update(schema.video)
    .set({ title: parsed.data.title, updatedAt: new Date() })
    .where(
      and(
        eq(schema.video.id, c.req.param("id")),
        eq(schema.video.teamId, c.get("identity").teamId!),
      ),
    )
    .returning({ id: schema.video.id });

  if (updated.length === 0) return c.json({ message: "No such recording." }, 404);
  return c.json({ ok: true });
});

/**
 * Unpublishes a recording.
 *
 * The objects go now — storage is the thing being paid for — but the row stays
 * with a `deletedAt`, so a link already sitting in somebody's chat says the
 * recording was deleted instead of hitting the site's 404 page, which reads as
 * the product being broken rather than as a deliberate act.
 */
videos.delete("/:id", async (c) => {
  const db = c.get("db");

  const [row] = await db
    .select()
    .from(schema.video)
    .where(
      and(
        eq(schema.video.id, c.req.param("id")),
        eq(schema.video.teamId, c.get("identity").teamId!),
      ),
    )
    .limit(1);

  if (!row) return c.json({ message: "No such recording." }, 404);

  const keys = [row.objectKey, row.posterKey].filter((key): key is string => key !== null);
  await c.env.MEDIA.delete(keys);

  await db
    .update(schema.video)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.video.id, row.id));

  return c.json({ ok: true });
});

/**
 * Bytes a team is actually using.
 *
 * Only `ready` rows count. An upload in flight has reserved nothing yet, and a
 * deleted one has had its objects removed — charging for either would drift
 * away from what R2 bills for and never come back.
 */
async function usage(db: Database, teamId: string) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.video.sizeBytes}), 0)` })
    .from(schema.video)
    .where(
      and(
        eq(schema.video.teamId, teamId),
        eq(schema.video.status, "ready"),
        isNull(schema.video.deletedAt),
      ),
    );

  return row?.total ?? 0;
}

export default videos;
