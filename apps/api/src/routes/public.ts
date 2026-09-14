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
import { avatarFileOf, avatarKey, isOurAvatar } from "../lib/avatars.ts";
import { vttFrom } from "../lib/captions.ts";
import { retryChaptersIfDue, type Transcript } from "../lib/chapters.ts";
import { sha256 } from "../lib/ids.ts";
import { captureServer } from "../lib/posthog.ts";
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
      chapters: schema.video.chapters,
      transcriptKey: schema.video.transcriptKey,
      transcriptLanguage: schema.video.transcriptLanguage,
      chaptersSource: schema.video.chaptersSource,
      chaptersRetryAt: schema.video.chaptersRetryAt,
      deletedAt: schema.video.deletedAt,
      status: schema.video.status,
      teamId: schema.video.teamId,
      teamName: schema.organization.name,
      ownerId: schema.video.ownerId,
      ownerName: schema.user.name,
      ownerImage: schema.user.image,
    })
    .from(schema.video)
    .leftJoin(schema.organization, eq(schema.video.teamId, schema.organization.id))
    .leftJoin(schema.user, eq(schema.video.ownerId, schema.user.id))
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

  // A view is when better chapters are worth having. Chapters the heuristic
  // wrote — because every model was down when the recording was shared — are
  // offered to the models again from here, at most once an hour.
  retryChaptersIfDue(c.env, c.executionCtx, db, row);

  // Anonymous, and it has to be. The person opening a share link has no account
  // and never will; making a PostHog person out of every one of them would fill
  // the project with rows that do exactly one thing each and are counted for
  // ever after. The team is still attributed, which is the part worth knowing.
  captureServer(c.env, c.executionCtx, {
    event: "video_viewed",
    distinctId: `video_${row.id}`,
    teamId: row.teamId,
    anonymous: true,
    properties: { duration_ms: row.durationMs, content_type: row.contentType },
  });

  return c.json({
    title: row.title,
    contentType: row.contentType,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    teamName: row.teamName,
    // Who shared it, for the page to draw. The avatar is a marble generated
    // from a seed, and the seed is a hash of the owner's id rather than the
    // email the dashboard seeds with: this answer goes to strangers, and an
    // email address on it would be the one thing about the owner they should
    // not be handed. The marble therefore differs from the owner's own, which
    // nobody opening a link has seen.
    owner: row.ownerId
      ? {
          name: row.ownerName ?? "Someone",
          seed: await sha256(row.ownerId),
          // Only a picture this API serves. A provider's URL still on the row
          // is one the copy has not reached, and is nobody's to hand out.
          image: isOurAvatar(c.env, row.ownerImage) ? row.ownerImage : null,
        }
      : null,
    createdAt: row.createdAt,
    // An empty list rather than null, so the page has one shape to render and
    // "no chapters" is the list being empty rather than a second case.
    chapters: row.chapters ?? [],
    // Whether there is a subtitle track, and its language. The track itself
    // is at `/p/:slug/captions.vtt`; the page builds that URL rather than
    // being handed it, because it fetches the track through its own origin.
    captions: row.transcriptKey ? { language: row.transcriptLanguage ?? "en" } : null,
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

/**
 * The subtitles, as WebVTT.
 *
 * Served rather than signed, for the poster's reasons: it is small, and a
 * `<track>` in a page is fetched again on every view. Unauthenticated, for
 * the share link's reason: the slug is the secret, and the words are those of
 * a recording anybody holding it can already watch. Deleting the recording
 * deletes the object, so this answers 404 from then on.
 */
publicRoutes.get("/:slug/captions.vtt", async (c) => {
  const db = database(c.env);

  const [row] = await db
    .select({ transcriptKey: schema.video.transcriptKey, deletedAt: schema.video.deletedAt })
    .from(schema.video)
    .where(eq(schema.video.slug, c.req.param("slug")))
    .limit(1);

  if (!row?.transcriptKey || row.deletedAt) return c.notFound();

  const object = await c.env.MEDIA.get(row.transcriptKey);
  if (!object) return c.notFound();

  const transcript = (await object.json()) as Transcript;

  return new Response(vttFrom(transcript), {
    headers: {
      "content-type": "text/vtt; charset=utf-8",
      // An hour, as the poster: a corrected transcript re-shared this
      // afternoon is showing by the evening, and a deleted one goes with it.
      "cache-control": "public, max-age=3600",
    },
  });
});

/**
 * A profile picture. Public and cached for a year: the file name is a random
 * token that changes with every upload, so a stale copy is never a wrong one.
 *
 * `/p/avatar/…` rather than `/p/:slug/…`, so the route cannot collide with a
 * recording whose slug happens to be `avatar` — slugs are sixteen characters,
 * and this segment is not.
 */
publicRoutes.get("/avatar/:file", async (c) => {
  const file = avatarFileOf(c.env, `${c.env.API_URL}/p/avatar/${c.req.param("file")}`);
  if (!file) return c.notFound();

  const object = await c.env.MEDIA.get(avatarKey(file));
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/jpeg",
      "content-length": String(object.size),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

export default publicRoutes;
