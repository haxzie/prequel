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
import { languageTag } from "../lib/captions.ts";
import { retryChaptersIfDue, storeChapters } from "../lib/chapters.ts";
import { id, slug } from "../lib/ids.ts";
import { captureServer } from "../lib/posthog.ts";
import {
  abortUpload,
  completeUpload,
  createUpload,
  PART_SIZE,
  posterKey,
  signedPlayback,
  signedUpload,
  signedUploadPart,
  transcriptKey,
  videoKey,
  worthSplitting,
  type UploadedPart,
} from "../lib/r2.ts";
import { describe, notify, personById } from "../lib/slack.ts";
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
  /** The export dialog's settings. Optional, so an older app still shares. */
  fps: z.number().int().positive().max(240).optional(),
  /** The Quality picker: the shorter edge in pixels, or null for the frame's own size. */
  shortEdge: z.number().int().positive().nullable().optional(),
  /**
   * Whether the client wants to send the bytes in parts.
   *
   * Absent means one PUT, because that is what every app built before parts
   * existed does and those must go on working — an old build asks for an upload
   * and gets `uploadUrl` exactly as it always did. A new one asks for parts and
   * gets `uploadId` and `partSize` instead.
   */
  multipart: z.boolean().default(false),
});

/**
 * Which parts the client wants somewhere to put.
 *
 * A range rather than the whole list at once. A signature lasts an hour and a
 * long upload on a slow uplink outlives that, so URLs for the end of a file
 * minted at the start would have expired by the time the client reached them.
 */
const Parts = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
});

/** How many part URLs one request may ask for. */
const MAX_PARTS_PER_REQUEST = 20;

const Complete = z.object({
  /** Absent for a single-PUT upload, which has nothing to assemble. */
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
    .optional(),
});

/** The team's library, newest first. */
videos.get("/", async (c) => {
  const db = c.get("db");
  const teamId = c.get("identity").teamId!;

  // The listing and the quota total are two independent scans of the same
  // table, and the page prints both. Awaiting them in turn put a second hop to
  // D1 in front of the library for a number rendered in the corner of it.
  const [rows, used] = await Promise.all([
    db
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
        exportFps: schema.video.exportFps,
        exportShortEdge: schema.video.exportShortEdge,
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
      .limit(200),

    usage(db, teamId),
  ]);

  // The same stable poster URL the share page uses, rather than a signature per
  // row. Two things follow: a browser can reuse a picture across navigations
  // instead of refetching a URL that differs every render, and a listing of two
  // hundred videos stops computing two hundred HMACs.
  //
  // Note it is `/p/:slug/poster` and not `/p/:slug` — the latter counts a view,
  // and a dashboard would register one for every recording on the page every
  // time somebody opened it.
  const videos = rows.map(({ posterKey: key, ...row }) => ({
    ...row,
    poster: key ? `${c.env.API_URL}/p/${row.slug}/poster` : null,
  }));

  return c.json({ videos, usage: used });
});

/**
 * Where the owning team watches its own recording.
 *
 * `/p/:slug` already mints a playback URL and this deliberately does not reuse
 * it: that route counts a view and captures `video_viewed`, so a dashboard built
 * on it would have every owner inflating the number printed on the same page —
 * and a team of five checking a link before sending it would put the count into
 * double figures before a stranger ever opened it. `GET /v1/videos` skirts the
 * same trap by linking `/p/:slug/poster` rather than `/p/:slug`.
 *
 * A signature per request rather than a column, and this is why the listing does
 * not carry one: `PLAYBACK_TTL` is six hours, so a URL rendered into a page has
 * to be minted when the page is, and two hundred of them per library render
 * would be two hundred HMACs nobody watches.
 */
videos.get("/:id/playback", async (c) => {
  const db = c.get("db");
  const [row] = await db
    .select({
      id: schema.video.id,
      slug: schema.video.slug,
      objectKey: schema.video.objectKey,
      contentType: schema.video.contentType,
      status: schema.video.status,
      deletedAt: schema.video.deletedAt,
      chapters: schema.video.chapters,
      durationMs: schema.video.durationMs,
      transcriptKey: schema.video.transcriptKey,
      transcriptLanguage: schema.video.transcriptLanguage,
      chaptersSource: schema.video.chaptersSource,
      chaptersRetryAt: schema.video.chaptersRetryAt,
    })
    .from(schema.video)
    .where(
      and(
        eq(schema.video.id, c.req.param("id")),
        // Scoped to the team, so this is not a way to read another team's key by
        // guessing an id. Every other handler here scopes the same way.
        eq(schema.video.teamId, c.get("identity").teamId!),
      ),
    )
    .limit(1);

  // One 404 for "not yours", "still uploading" and "deleted". None of the three
  // has anything to play, and the page above falls back to the still.
  if (!row || row.status !== "ready" || row.deletedAt) {
    return c.json({ message: "No such recording." }, 404);
  }

  // The owner checking the link is as good a moment as any to try the models
  // again on chapters the heuristic wrote.
  retryChaptersIfDue(c.env, c.executionCtx, db, row);

  return c.json({
    src: await signedPlayback(c.env, row.objectKey),
    // The player has to know before it draws: a `<video>` pointed at a GIF shows
    // a black rectangle with controls and reports no error at all.
    contentType: row.contentType,
    // With the playback URL rather than in the listing, because the two are
    // read by the same page and only that page: the library's grid draws a
    // still and a title, and two hundred tables of contents would be the
    // biggest thing in a response nothing on it reads.
    chapters: row.chapters ?? [],
    // The dashboard's player fetches the same public track the share page
    // does, by slug — one track, one cache, and nothing to sign.
    slug: row.slug,
    captions: row.transcriptKey ? { language: row.transcriptLanguage ?? "en" } : null,
  });
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

  // Together, as `GET /` does: two independent reads are one round trip to D1
  // rather than two, on the request a user is waiting on after pressing Share.
  const [[team], used] = await Promise.all([
    db
      .select({ quota: schema.organization.storageQuotaBytes })
      .from(schema.organization)
      .where(eq(schema.organization.id, teamId!))
      .limit(1),
    usage(db, teamId!),
  ]);
  if (team && used + body.sizeBytes > team.quota) {
    // Worth an event of its own: somebody hitting this has finished a recording,
    // pressed Share and been turned away, which is the point in the product
    // where a plan limit actually costs something.
    captureServer(c.env, c.executionCtx, {
      event: "upload_quota_exceeded",
      userId,
      teamId,
      properties: { size_bytes: body.sizeBytes, used_bytes: used, quota_bytes: team.quota },
    });

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

  // Before the row, because the row stores the id it hands back and a row
  // written first would have to be undone if this failed.
  // The client asks; the size decides. A file too small to reach a second part
  // is refused by R2 at `complete` if it is split, and gains nothing from being
  // split even if it were not — see `worthSplitting`.
  const uploadId =
    body.multipart && worthSplitting(body.sizeBytes)
      ? await createUpload(c.env, key, body.contentType)
      : null;

  await db.insert(schema.video).values({
    id: videoId,
    slug: slug(),
    teamId: teamId!,
    ownerId: userId,
    title: body.title,
    status: "uploading",
    objectKey: key,
    uploadId,
    posterKey: poster,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
    durationMs: body.durationMs,
    width: body.width,
    height: body.height,
    exportFps: body.fps ?? null,
    exportShortEdge: body.shortEdge ?? null,
  });

  const [uploadUrl, posterUploadUrl] = await Promise.all([
    // Not minted for a multipart upload: there is no one URL to PUT the file
    // to, and handing back both would let a client send the whole object over
    // the top of the parts it is also sending.
    uploadId ? null : signedUpload(c.env, key, body.contentType),
    poster && body.posterContentType ? signedUpload(c.env, poster, body.posterContentType) : null,
  ]);

  return c.json({
    id: videoId,
    uploadUrl,
    posterUploadUrl,
    uploadId,
    // Told, not chosen. Every part but the last has to be exactly this or the
    // whole upload is refused at the end — see `PART_SIZE`.
    partSize: uploadId ? PART_SIZE : null,
  });
});

/**
 * Somewhere to put the next few parts.
 *
 * Bounded per request and checked against the row's own upload, so an expired
 * or already-finished share cannot be handed fresh URLs to write through.
 */
videos.post("/:id/upload/parts", async (c) => {
  const db = c.get("db");
  const { teamId } = c.get("identity");

  const parsed = Parts.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That isn't a range of parts." }, 400);

  const { from, to } = parsed.data;
  if (to < from || to - from + 1 > MAX_PARTS_PER_REQUEST) {
    return c.json({ message: "Ask for fewer parts at a time." }, 400);
  }

  const [row] = await db
    .select()
    .from(schema.video)
    .where(and(eq(schema.video.id, c.req.param("id")), eq(schema.video.teamId, teamId!)))
    .limit(1);

  if (!row) return c.json({ message: "No such upload." }, 404);
  // Asked before the upload id, not after. Finishing a share clears the id, so
  // the other order answers "no such upload" for one that exists and is simply
  // already done — which reads as the share having been lost.
  if (row.status !== "uploading") return c.json({ message: "That upload is finished." }, 409);
  if (!row.uploadId) return c.json({ message: "No such upload." }, 404);

  const urls = await Promise.all(
    Array.from({ length: to - from + 1 }, (_, index) =>
      signedUploadPart(c.env, row.objectKey, row.uploadId!, from + index).then((url) => ({
        partNumber: from + index,
        url,
      })),
    ),
  );

  return c.json({ parts: urls });
});

/**
 * Gives up on an upload, and takes the parts with it.
 *
 * Called when a share is cancelled or fails for good. Unlike a single PUT —
 * which leaves nothing behind when it breaks — the parts of an abandoned
 * multipart upload sit in the bucket, invisible to everyone and billed to the
 * team, until something names the upload they belong to. This is that something.
 *
 * The app cannot be relied on to reach here: it can be force quit, and the Mac
 * can lose power. A bucket lifecycle rule for incomplete multipart uploads is
 * the backstop, and this is the tidy path rather than the only one.
 */
videos.delete("/:id/upload", async (c) => {
  const db = c.get("db");
  const { teamId } = c.get("identity");

  const [row] = await db
    .select()
    .from(schema.video)
    .where(and(eq(schema.video.id, c.req.param("id")), eq(schema.video.teamId, teamId!)))
    .limit(1);

  if (!row) return c.json({ message: "No such recording." }, 404);

  if (row.uploadId) await abortUpload(c.env, row.objectKey, row.uploadId);

  await db
    .update(schema.video)
    .set({ status: "failed", uploadId: null, updatedAt: new Date() })
    .where(eq(schema.video.id, row.id));

  return c.json({ ok: true });
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

  // The parts, assembled into the object, before anything asks whether the
  // object is there — until this runs a multipart upload has no object at all,
  // only parts, and the HEAD below would report an upload that never finished.
  if (row.uploadId) {
    const parsed = Complete.safeParse(await c.req.json().catch(() => null));
    const parts: UploadedPart[] = parsed.success ? (parsed.data.parts ?? []) : [];

    if (parts.length === 0) {
      await abortUpload(c.env, row.objectKey, row.uploadId);
      await db
        .update(schema.video)
        .set({ status: "failed", uploadId: null, updatedAt: new Date() })
        .where(eq(schema.video.id, row.id));

      return c.json({ message: "The upload didn't finish." }, 400);
    }

    try {
      await completeUpload(c.env, row.objectKey, row.uploadId, parts);
    } catch (cause) {
      // A refused assembly is the end of this upload: the parts are wrong, or
      // one of them never arrived, and neither is something a retry of this
      // call would mend. Aborted rather than left, or they are storage nobody
      // can see and the team is paying for.
      console.error("videos: could not assemble an upload", cause);
      await abortUpload(c.env, row.objectKey, row.uploadId);
      await db
        .update(schema.video)
        .set({ status: "failed", uploadId: null, updatedAt: new Date() })
        .where(eq(schema.video.id, row.id));

      return c.json({ message: "The upload didn't finish." }, 400);
    }
  }

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
    .set({
      status: "ready",
      // Cleared on the way through: the upload is finished, and an id left on a
      // ready row is one `DELETE /upload` could still be pointed at.
      uploadId: null,
      sizeBytes: object.size,
      updatedAt: new Date(),
    })
    .where(eq(schema.video.id, row.id));

  // The authoritative share. The app reports one of its own, but only this point
  // knows the object actually arrived, and at what size — the number here is
  // R2's rather than the one the client declared.
  captureServer(c.env, c.executionCtx, {
    event: "video_shared",
    userId: row.ownerId,
    teamId: row.teamId,
    properties: {
      size_bytes: object.size,
      duration_ms: row.durationMs,
      content_type: row.contentType,
      width: row.width,
      height: row.height,
    },
  });

  const url = `${c.env.APP_URL}/v/${row.slug}`;

  // The link, because a share notification without one is an errand rather than
  // a notification — the first thing anybody does on reading this is watch it.
  // `ownerId` is nullable — a recording outlives the account that made it — so
  // the lookup is skipped rather than made with a null, and `describe` says so.
  const owner = row.ownerId ? await personById(db, row.ownerId) : null;

  notify(c.env, c.executionCtx, "events", `*Video shared* — ${describe(owner)}\n${url}`);

  return c.json({ id: row.id, slug: row.slug, url });
});

/**
 * The finished cut's words, in output time.
 *
 * Capped at the size of a long talk. A transcript is a few dozen bytes a word,
 * so twenty thousand words is well past an hour of continuous speech and well
 * under anything a Worker minds receiving.
 */
const TranscriptBody = z.object({
  language: z.string().min(2).max(35).default("en"),
  words: z
    .array(
      z.object({
        at: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        text: z.string().min(1).max(200),
      }),
    )
    .max(20_000),
});

/**
 * Takes the transcript, and makes the chapters from it.
 *
 * Its own request rather than a field on `complete`, and it is meant to arrive
 * *before* the bytes do: the app sends it as soon as the row exists, so the
 * model is reading while the upload runs and the chapters are on the row by the
 * time there is a link to open. Making it part of `complete` would put the
 * model's latency between pressing Share and getting a link, for a table of
 * contents nobody is looking at yet.
 *
 * Answers as soon as the transcript is stored. The generation runs in
 * `waitUntil`, and its failure is nobody's error — the row simply has no
 * chapters, which is what it had before.
 */
videos.post("/:id/transcript", async (c) => {
  const db = c.get("db");
  const { teamId } = c.get("identity");

  const parsed = TranscriptBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That transcript isn't valid." }, 400);

  const [row] = await db
    .select({
      id: schema.video.id,
      durationMs: schema.video.durationMs,
      deletedAt: schema.video.deletedAt,
    })
    .from(schema.video)
    .where(and(eq(schema.video.id, c.req.param("id")), eq(schema.video.teamId, teamId!)))
    .limit(1);

  if (!row || row.deletedAt) return c.json({ message: "No such recording." }, 404);

  const transcript = parsed.data;
  const key = transcriptKey(teamId!, row.id);

  await c.env.MEDIA.put(key, JSON.stringify(transcript), {
    httpMetadata: { contentType: "application/json" },
  });

  // Cleared as well as set: a second transcript for the same recording — a
  // re-share after correcting the captions — must not leave the first one's
  // chapters on the row while the new ones are being made.
  await db
    .update(schema.video)
    .set({
      transcriptKey: key,
      transcriptLanguage: languageTag(transcript.language),
      chapters: null,
      chaptersSource: null,
      chaptersModel: null,
      chaptersInputTokens: null,
      chaptersOutputTokens: null,
      chaptersRetryAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.video.id, row.id));

  c.executionCtx.waitUntil(
    storeChapters(c.env, db, row.id, transcript, row.durationMs).catch((error: unknown) =>
      console.error("chapters: failed to store", error),
    ),
  );

  return c.json({ ok: true }, 202);
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

  const keys = [row.objectKey, row.posterKey, row.transcriptKey].filter(
    (key): key is string => key !== null,
  );
  await c.env.MEDIA.delete(keys);

  await db
    .update(schema.video)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.video.id, row.id));

  captureServer(c.env, c.executionCtx, {
    event: "video_deleted",
    userId: c.get("identity").userId,
    teamId: row.teamId,
    properties: { size_bytes: row.sizeBytes, view_count: row.viewCount },
  });

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
