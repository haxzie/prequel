/**
 * The tables Prequel owns, as opposed to the ones Better Auth does.
 *
 * Kept in a separate file so a Better Auth upgrade can be diffed against
 * `auth-schema.ts` alone, without a rename in their schema hiding inside a
 * change to ours.
 */
import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization, user } from "./auth-schema.ts";

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

/**
 * A recording that has been shared.
 *
 * Only exports somebody pressed Share on land here. A recording that was never
 * shared has no row and no object — the library is what has been published, not
 * an inventory of the Mac.
 */
export const video = sqliteTable(
  "video",
  {
    id: text("id").primaryKey(),
    /**
     * What `/v/<slug>` resolves. Sixteen base58 characters of CSPRNG output.
     *
     * The share link is unlisted-public: no login, no membership check, nothing
     * between a stranger and the video but the difficulty of guessing this. It
     * is therefore *not* the row id, which appears in dashboard URLs and in
     * error messages, and it is long enough that enumeration is not a strategy.
     */
    slug: text("slug").notNull().unique(),
    teamId: text("team_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Who shared it.
     *
     * `set null` rather than cascade: a member leaving the team must not take
     * the team's videos with them. The row survives with no owner and the
     * library shows it as the team's.
     */
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /**
     * `uploading` until the object is confirmed present at the declared size.
     *
     * A row is written *before* the bytes are sent, so the presigned URL can
     * name a key that already belongs to something. Anything still `uploading`
     * an hour later is an upload that was abandoned, and is not shown or
     * counted against the quota.
     */
    status: text("status", { enum: ["uploading", "ready", "failed"] })
      .notNull()
      .default("uploading"),
    objectKey: text("object_key").notNull(),
    posterKey: text("poster_key"),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    /**
     * Soft delete.
     *
     * The R2 objects go immediately; this row stays so a link that is already
     * in somebody's chat resolves to "this recording was deleted" rather than
     * to the 404 page, which reads as a broken product.
     */
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // The library's only query: this team's videos, newest first.
    index("video_team_created_idx").on(table.teamId, table.createdAt),
    index("video_owner_idx").on(table.ownerId),
  ],
);

/**
 * A signed-in copy of the desktop app.
 *
 * Separate from `session` because the two expire on completely different
 * scales: a browser session is days, and a Mac that has been signed in should
 * stay signed in until somebody says otherwise. Reusing the session table would
 * mean either logging the app out every week or making browser sessions
 * effectively permanent.
 */
export const deviceToken = sqliteTable(
  "device_token",
  {
    id: text("id").primaryKey(),
    /**
     * SHA-256 of the token. The plaintext exists in exactly two places — the
     * response that created it, and `auth.json` on the user's Mac.
     *
     * A readable token column would mean anybody with a copy of the database
     * could sign in as any user on any machine, which is the one property that
     * distinguishes this from storing passwords in the clear.
     */
    tokenHash: text("token_hash").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The Mac's hostname, so the account page can name the device being revoked. */
    label: text("label").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (table) => [index("device_token_user_idx").on(table.userId)],
);

/**
 * One leg of the desktop sign-in handshake.
 *
 * The browser creates a row; the app redeems it over the `prequel://` deep link
 * within minutes. Both halves are needed to get a token, which is what stops a
 * deep link captured out of the system log from being worth anything on its own.
 */
export const desktopAuthCode = sqliteTable(
  "desktop_auth_code",
  {
    code: text("code").primaryKey(),
    /**
     * base64url(SHA-256(verifier)). The app keeps the verifier in memory and
     * never sends it until it is exchanging the code, so the value that travels
     * through the browser and the URL bar cannot be replayed by whoever sees it.
     */
    challenge: text("challenge").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => organization.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    /**
     * Stamped on exchange instead of deleting the row.
     *
     * A replay then answers "already used" rather than "no such code", and the
     * two are worth telling apart when somebody reports that signing in did not
     * work — one is a stale link, the other is a bug.
     */
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (table) => [index("desktop_auth_code_user_idx").on(table.userId)],
);

/**
 * The transcription allowance, per subject per window.
 *
 * In the database rather than in memory, which is what this used to be. The old
 * `Map` in the Next route was per-instance and reset on every deploy, so the
 * real limit was "12 per hour, times however many lambdas are warm, times how
 * recently we shipped". One row per subject per window makes the number mean
 * what it says.
 *
 * `windowStart` is part of the key rather than a value to reset, so a new window
 * is an insert and an existing one is an update — there is no read-then-write
 * in between for two concurrent requests to interleave inside.
 */
export const rateLimit = sqliteTable(
  "rate_limit",
  {
    /** `install:<uuid>` or `user:<id>` — the prefix keeps the two from colliding. */
    subject: text("subject").notNull(),
    /** The window's start, in whole seconds. */
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [uniqueIndex("rate_limit_subject_window_idx").on(table.subject, table.windowStart)],
);

export const videoRelations = relations(video, ({ one }) => ({
  team: one(organization, { fields: [video.teamId], references: [organization.id] }),
  owner: one(user, { fields: [video.ownerId], references: [user.id] }),
}));

export type Video = typeof video.$inferSelect;
export type NewVideo = typeof video.$inferInsert;
export type DeviceToken = typeof deviceToken.$inferSelect;
