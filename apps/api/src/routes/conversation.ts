/**
 * What people say back about a shared recording.
 *
 * Mounted under `/p` beside the share link's own routes, and split from them
 * for one reason: `public.ts` is unauthenticated from top to bottom and says so
 * in its opening line, while half of this file requires a session. Reading is
 * public — anybody holding the link sees every comment, because the link is the
 * permission — and writing is not, which is the decision this file exists to
 * enforce.
 *
 * Nothing here is rendered. A comment is stored as the markdown it was typed
 * as, and the page builds elements from it rather than HTML; sanitising on the
 * way in would mangle a body that was never dangerous and could never be
 * un-mangled afterwards.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";
import type { Env } from "../env.ts";
import { isOurAvatar } from "../lib/avatars.ts";
import { id, sha256 } from "../lib/ids.ts";
import { captureServer } from "../lib/posthog.ts";
import { take } from "../lib/rate-limit.ts";
import { isReaction, REACTIONS } from "../lib/reactions.ts";
import { authenticate, optionalIdentity, type AppContext } from "../middleware.ts";

const conversation = new Hono<AppContext>();

/** The longest a comment may be. Long enough for a paragraph of review, short enough to read. */
const MAX_BODY = 4_000;

/**
 * How many comments and reactions one account may leave an hour.
 *
 * Generous for a person and useless for a script. A share link is handed out
 * freely and the account behind a write is free to make, so "signed in" is not
 * by itself a reason to trust a thousand requests a minute.
 */
const COMMENT_ALLOWANCE = { limit: 60, windowSeconds: 3_600 };
const REACTION_ALLOWANCE = { limit: 240, windowSeconds: 3_600 };

/**
 * The most reactions one recording will hold.
 *
 * The bar is a few hundred pixels wide and every reaction is drawn on it, so
 * past some number they are no longer marks on a timeline but a smear across
 * it. The limit is on the recording rather than on the person for that reason —
 * what it protects is the picture, not the database.
 */
const MAX_REACTIONS_PER_VIDEO = 500;

const Comment = z.object({ body: z.string().trim().min(1).max(MAX_BODY) });

const Reaction = z.object({
  emoji: z.string().refine(isReaction, "That isn't one of the reactions."),
  atMs: z.number().int().nonnegative(),
});

/** The recording a slug names, if it is one anybody may still watch. */
async function videoBySlug(db: Database, slug: string) {
  const [row] = await db
    .select({
      id: schema.video.id,
      teamId: schema.video.teamId,
      durationMs: schema.video.durationMs,
      status: schema.video.status,
      deletedAt: schema.video.deletedAt,
    })
    .from(schema.video)
    .where(eq(schema.video.slug, slug))
    .limit(1);

  if (!row || row.status !== "ready" || row.deletedAt) return null;
  return row;
}

/**
 * How somebody is drawn to everybody else.
 *
 * The same treatment the share page gives the recording's owner, and for the
 * same reason: this goes to strangers, so the avatar is a marble seeded from a
 * hash of the user id rather than from the email the dashboard seeds with, and
 * a picture is only passed on when it is one this API serves. A provider's URL
 * still on the row is Google's to hand out, not ours.
 */
async function authorOf(
  env: Env,
  row: { authorId: string | null; authorName: string | null; authorImage: string | null },
) {
  if (!row.authorId) return null;

  return {
    name: row.authorName ?? "Someone",
    seed: await sha256(row.authorId),
    image: isOurAvatar(env, row.authorImage) ? row.authorImage : null,
  };
}

/**
 * Everything the panel draws, in one request.
 *
 * Comments and reactions together because the page shows both at once and two
 * round-trips to render one panel is one more than it needs. The palette rides
 * along so the page offers exactly what this file will accept.
 *
 * Open to anybody holding the link, and it reads the session anyway: `mine` is
 * what lets somebody delete their own comment, and resolving it here means the
 * page never has to be told who it is talking to.
 */
conversation.get("/:slug/conversation", async (c) => {
  const identity = await optionalIdentity(c);
  const db = c.get("db");

  const video = await videoBySlug(db, c.req.param("slug"));
  if (!video) return c.json({ message: "No such recording." }, 404);

  const [comments, reactions] = await Promise.all([
    db
      .select({
        id: schema.videoComment.id,
        body: schema.videoComment.body,
        createdAt: schema.videoComment.createdAt,
        deletedAt: schema.videoComment.deletedAt,
        authorId: schema.videoComment.authorId,
        authorName: schema.user.name,
        authorImage: schema.user.image,
      })
      .from(schema.videoComment)
      .leftJoin(schema.user, eq(schema.videoComment.authorId, schema.user.id))
      .where(eq(schema.videoComment.videoId, video.id))
      .orderBy(asc(schema.videoComment.createdAt))
      .limit(500),
    db
      .select({
        id: schema.videoReaction.id,
        emoji: schema.videoReaction.emoji,
        atMs: schema.videoReaction.atMs,
        userId: schema.videoReaction.userId,
        userName: schema.user.name,
      })
      .from(schema.videoReaction)
      .leftJoin(schema.user, eq(schema.videoReaction.userId, schema.user.id))
      .where(eq(schema.videoReaction.videoId, video.id))
      .orderBy(asc(schema.videoReaction.atMs))
      .limit(MAX_REACTIONS_PER_VIDEO),
  ]);

  return c.json({
    palette: REACTIONS,
    comments: await Promise.all(
      comments.map(async (row) => ({
        id: row.id,
        // A deleted comment keeps its place and loses its words. The gap is
        // the honest shape of a conversation somebody withdrew from; closing
        // it up makes the replies around it read as answers to nothing.
        body: row.deletedAt ? null : row.body,
        createdAt: row.createdAt,
        author: row.deletedAt ? null : await authorOf(c.env, row),
        mine: identity !== null && row.authorId === identity.userId && !row.deletedAt,
      })),
    ),
    reactions: reactions.map((row) => ({
      id: row.id,
      emoji: row.emoji,
      atMs: row.atMs,
      by: row.userName ?? "Someone",
      mine: identity !== null && row.userId === identity.userId,
    })),
  });
});

conversation.post("/:slug/comments", authenticate, async (c) => {
  const db = c.get("db");
  const { userId } = c.get("identity");

  const video = await videoBySlug(db, c.req.param("slug"));
  if (!video) return c.json({ message: "No such recording." }, 404);

  const parsed = Comment.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That isn't a comment." }, 400);

  if (!(await take(db, `comment:${userId}`, COMMENT_ALLOWANCE))) {
    return c.json({ message: "That's a lot of comments. Try again shortly." }, 429);
  }

  const row = {
    id: id("cmt"),
    videoId: video.id,
    authorId: userId,
    body: parsed.data.body,
    createdAt: new Date(),
  };

  await db.insert(schema.videoComment).values(row);

  const [author] = await db
    .select({ name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  captureServer(c.env, c.executionCtx, {
    event: "video_commented",
    userId,
    teamId: video.teamId,
    properties: { length: row.body.length },
  });

  return c.json(
    {
      id: row.id,
      body: row.body,
      createdAt: row.createdAt,
      author: await authorOf(c.env, {
        authorId: userId,
        authorName: author?.name ?? null,
        authorImage: author?.image ?? null,
      }),
      mine: true,
    },
    201,
  );
});

/**
 * Taking one back.
 *
 * The author, or anybody on the team that owns the recording — somebody who
 * shared a recording with a client must be able to clear what was left under it
 * without asking the person who wrote it. Both cases answer the same 404 when
 * neither applies, so a guessed id says nothing about whether it exists.
 */
conversation.delete("/:slug/comments/:id", authenticate, async (c) => {
  const db = c.get("db");
  const { userId, teamId } = c.get("identity");

  const video = await videoBySlug(db, c.req.param("slug"));
  if (!video) return c.json({ message: "No such recording." }, 404);

  const [row] = await db
    .select({ id: schema.videoComment.id, authorId: schema.videoComment.authorId })
    .from(schema.videoComment)
    .where(
      and(
        eq(schema.videoComment.id, c.req.param("id")),
        eq(schema.videoComment.videoId, video.id),
        isNull(schema.videoComment.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return c.json({ message: "No such comment." }, 404);

  if (row.authorId !== userId && teamId !== video.teamId) {
    return c.json({ message: "No such comment." }, 404);
  }

  await db
    .update(schema.videoComment)
    .set({ deletedAt: new Date() })
    .where(eq(schema.videoComment.id, row.id));

  return c.json({ ok: true });
});

conversation.post("/:slug/reactions", authenticate, async (c) => {
  const db = c.get("db");
  const { userId } = c.get("identity");

  const video = await videoBySlug(db, c.req.param("slug"));
  if (!video) return c.json({ message: "No such recording." }, 404);

  const parsed = Reaction.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That isn't a reaction." }, 400);

  if (!(await take(db, `reaction:${userId}`, REACTION_ALLOWANCE))) {
    return c.json({ message: "That's a lot of reactions. Try again shortly." }, 429);
  }

  const [{ count = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.videoReaction)
    .where(eq(schema.videoReaction.videoId, video.id));

  if (count >= MAX_REACTIONS_PER_VIDEO) {
    return c.json({ message: "This recording has all the reactions it can hold." }, 409);
  }

  // Clamped to the recording rather than rejected. The client sends the
  // playhead, and a player sitting at the very end reports a time a hair past
  // the duration the row records — refusing that would make the last press of
  // every recording fail for a rounding difference nobody can see. A duration
  // of zero is an old row that never recorded one, and is left alone.
  const atMs =
    video.durationMs > 0 ? Math.min(parsed.data.atMs, video.durationMs) : parsed.data.atMs;

  const row = {
    id: id("rxn"),
    videoId: video.id,
    userId,
    emoji: parsed.data.emoji,
    atMs,
    createdAt: new Date(),
  };

  await db.insert(schema.videoReaction).values(row);

  const [who] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  captureServer(c.env, c.executionCtx, {
    event: "video_reacted",
    userId,
    teamId: video.teamId,
    properties: { emoji: row.emoji, at_ms: row.atMs },
  });

  return c.json(
    { id: row.id, emoji: row.emoji, atMs: row.atMs, by: who?.name ?? "Someone", mine: true },
    201,
  );
});

/** Undoing a press. The person who made it, and nobody else — a mark is not the owner's to edit. */
conversation.delete("/:slug/reactions/:id", authenticate, async (c) => {
  const db = c.get("db");
  const { userId } = c.get("identity");

  const video = await videoBySlug(db, c.req.param("slug"));
  if (!video) return c.json({ message: "No such recording." }, 404);

  const deleted = await db
    .delete(schema.videoReaction)
    .where(
      and(
        eq(schema.videoReaction.id, c.req.param("id")),
        eq(schema.videoReaction.videoId, video.id),
        eq(schema.videoReaction.userId, userId),
      ),
    )
    .returning({ id: schema.videoReaction.id });

  if (deleted.length === 0) return c.json({ message: "No such reaction." }, 404);

  return c.json({ ok: true });
});

export default conversation;
