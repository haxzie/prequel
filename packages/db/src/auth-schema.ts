/**
 * The tables Better Auth owns.
 *
 * Transcribed from Better Auth's own schema rather than generated into the
 * tree, because `drizzle-kit generate` needs the definitions at hand and a
 * generated file that nobody may edit is worse than one that is checked and
 * commented. Regenerate the reference with `better-auth generate` after a major
 * upgrade and diff it against this.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * The **property names are the contract**, not the column names. The Drizzle
 * adapter looks fields up by the key on the exported object — `emailVerified`,
 * not `email_verified` — and a mismatch is not a type error. It surfaces as a
 * runtime "field not found" on whichever flow touches that column first, which
 * for most of these is somebody's first login.
 *
 * The **table names are singular**. Better Auth's `usePlural` defaults to false,
 * and a plural export makes it look for a table that is not there.
 */
import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Timestamps, in seconds.
 *
 * `mode: "timestamp"` rather than `timestamp_ms` throughout — the two are
 * indistinguishable in the column and produce dates 50 000 years apart when
 * mixed, so the only safe rule is one mode everywhere. Better Auth hands the
 * adapter `Date` objects and reads them back the same way.
 */
const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * Which team the session is currently looking at.
     *
     * Added by the organization plugin and stored on the session rather than on
     * the user: the same account open in two browsers can be pointed at two
     * teams, and hanging this off the user would make switching in one tab
     * silently switch the other.
     */
    activeOrganizationId: text("active_organization_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    /**
     * Who vouched for this identity — `https://accounts.google.com`, and so on.
     *
     * Distinct from `providerId` ("google"), which names the configured provider
     * rather than the authority. Better Auth looks an account's owner up by
     * `(issuer, accountId)`, so this is not decoration: without the column the
     * adapter emits a `where ( = ?)` with no column name at all, and D1 rejects
     * the statement as a syntax error on the first Google sign-in anybody tries.
     */
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("account_user_idx").on(table.userId),
    // On `(issuer, accountId)` because that is the pair Better Auth looks an
    // account's owner up by — so this both enforces the constraint and is the
    // index that query can use. Without it a retried OAuth callback can link the
    // same Google account twice, and the next login has two rows to choose from.
    uniqueIndex("account_issuer_idx").on(table.issuer, table.accountId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/**
 * A team.
 *
 * Called `organization` because that is the table the plugin looks for; it is
 * only ever "team" in the interface. Renaming it would mean re-mapping every
 * one of the plugin's queries for a word the user never sees in a URL.
 */
export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  /**
   * Billing, which does not exist yet.
   *
   * Here from the first migration rather than added when payments land: the
   * quota below is what upload checks against, and a column added later would
   * need every existing team backfilled before the check could be trusted.
   */
  plan: text("plan", { enum: ["free", "pro"] })
    .notNull()
    .default("free"),
  /** Total bytes this team's videos may occupy. */
  storageQuotaBytes: integer("storage_quota_bytes")
    .notNull()
    .default(2 * 1024 * 1024 * 1024),
  createdAt: createdAt(),
});

export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (table) => [
    index("member_org_idx").on(table.organizationId),
    index("member_user_idx").on(table.userId),
    // Accepting the same invitation twice is one click on a stale email, and
    // two rows would show the person twice in the member list with two roles.
    uniqueIndex("member_org_user_idx").on(table.organizationId, table.userId),
  ],
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("invitation_org_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(member),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, { fields: [member.userId], references: [user.id] }),
}));
