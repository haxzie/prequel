/**
 * The hourly sweep, for the two states nothing announces.
 *
 * Everything else about billing is driven by a webhook, because Dodo says what
 * it does. These two have nobody to say it:
 *
 * - A grace window running out. A failed renewal fires `subscription.on_hold`
 *   once, and the moment seven days later when that team stops being Pro is not
 *   an event anywhere. It is just a timestamp going past.
 * - A team with nobody in it, or an account with no team. Creating a team is
 *   two writes with no transaction across them — the organization, then the
 *   membership — so a failure between them leaves one or the other stranded.
 *   Neither is an event; both are just rows that disagree, so they are swept
 *   for from both ends.
 */
import { and, eq, isNotNull, lt, ne, notExists, sql } from "drizzle-orm";

import { schema } from "@prequel/db";

import { database } from "./db.ts";
import type { Env } from "./env.ts";
import { FREE_QUOTA_BYTES } from "./lib/entitlement.ts";
import { id } from "./lib/ids.ts";
import { ensureTeam } from "./lib/teams.ts";

export async function scheduled(env: Env): Promise<void> {
  const db = database(env);

  await expireGrace(db);
  await settleTeams(db);
  await settleUsers(db);
}

type Database = ReturnType<typeof database>;

/**
 * Teams whose grace window has closed without the payment recovering.
 *
 * `ne(status, "active")` as well as the timestamp: a card retried successfully
 * clears `graceUntil` through `subscription.renewed`, but a delivery that never
 * arrived would otherwise leave a paying team to be downgraded by this.
 */
async function expireGrace(db: Database): Promise<void> {
  const lapsed = await db
    .select({ id: schema.subscription.id, teamId: schema.subscription.teamId })
    .from(schema.subscription)
    .where(
      and(
        isNotNull(schema.subscription.graceUntil),
        lt(schema.subscription.graceUntil, new Date()),
        ne(schema.subscription.status, "active"),
      ),
    );

  for (const subscription of lapsed) {
    await db
      .update(schema.subscription)
      .set({ graceUntil: null, updatedAt: new Date() })
      .where(eq(schema.subscription.id, subscription.id));

    // The library is left alone, the same as on an outright cancellation. What
    // changes is the quota, so nothing new goes up until the card does.
    await db
      .update(schema.organization)
      .set({ plan: "free", storageQuotaBytes: FREE_QUOTA_BYTES })
      .where(eq(schema.organization.id, subscription.teamId));

    console.warn("grace expired, team downgraded", subscription.teamId);
  }
}

/**
 * How long a team may have no members before it is treated as broken.
 *
 * The real gap between the two writes is milliseconds. An hour is the same
 * allowance `video.status` gives an upload that never finished — long enough
 * that nothing in flight is ever touched, short enough that a broken team is
 * repaired before the person who made it has given up and gone to bed.
 */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/**
 * Teams with nobody in them: repaired where possible, removed where not.
 *
 * Repair is the point, and it is what `organization.createdBy` exists for. A
 * team whose creator is known and who has no other team is a team that failed
 * to be finished, and seating them is the whole of the repair — they get back
 * exactly the team they named. Deleting it instead would be correct only in the
 * sense that the row would be gone.
 *
 * What cannot be repaired is only deleted when it is provably empty: no videos
 * and no subscription. A team with videos and no members is a different fault
 * with somebody's recordings inside it, and cascading it away here would turn a
 * bookkeeping problem into data loss. That one is logged and left.
 */
async function settleTeams(db: Database): Promise<void> {
  const orphans = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      createdBy: schema.organization.createdBy,
    })
    .from(schema.organization)
    .where(
      and(
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.member)
            .where(eq(schema.member.organizationId, schema.organization.id)),
        ),
        lt(schema.organization.createdAt, new Date(Date.now() - ORPHAN_GRACE_MS)),
      ),
    );

  for (const team of orphans) {
    if (await repair(db, team)) continue;

    // Provably empty, so there is nothing for the cascade to take.
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.video)
      .where(eq(schema.video.teamId, team.id));

    const [subscription] = await db
      .select({ id: schema.subscription.id })
      .from(schema.subscription)
      .where(eq(schema.subscription.teamId, team.id))
      .limit(1);

    if (count > 0 || subscription) {
      console.error("team has no members but is not empty", team.id, team.name);
      continue;
    }

    await db.delete(schema.organization).where(eq(schema.organization.id, team.id));
    console.warn("empty team removed", team.id, team.name);
  }
}

/**
 * Seats the creator of a team that lost its founding membership.
 *
 * Refuses when they have picked up a team since — almost certainly by retrying
 * onboarding, which is what a user does when this happens. Seating them again
 * would hand them a second team, which `organizationLimit: 1` exists to prevent
 * and which nothing in the dashboard can switch between.
 */
async function repair(
  db: Database,
  team: { id: string; name: string; createdBy: string | null },
): Promise<boolean> {
  if (!team.createdBy) return false;

  const [existing] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(eq(schema.member.userId, team.createdBy))
    .limit(1);

  if (existing) return false;

  await db.insert(schema.member).values({
    id: id("mem"),
    organizationId: team.id,
    userId: team.createdBy,
    role: "owner",
  });

  console.warn("team re-seated with its creator", team.id, team.name, team.createdBy);
  return true;
}

/**
 * Accounts with no team, which is now a broken account rather than a new one.
 *
 * Teams are created with the account — see `lib/teams.ts` — so this only ever
 * finds someone whose sign-up hook failed. `/v1/me` fixes it too, and faster,
 * but only for somebody who opens the dashboard: an account that only ever
 * signs in from the Mac would otherwise sit there unable to share, being told
 * to create a team by a product that no longer has anywhere to do that.
 *
 * Runs after `settleTeams`, so an account whose team merely lost its membership
 * has already been reunited with it rather than given a second one.
 */
async function settleUsers(db: Database): Promise<void> {
  const stranded = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(schema.member)
          .where(eq(schema.member.userId, schema.user.id)),
      ),
    );

  for (const user of stranded) {
    // One failure must not stop the sweep: a slug collision on one account has
    // nothing to do with the next one.
    const teamId = await ensureTeam(db, user).catch((error: unknown) => {
      console.error("scheduled team creation failed", user.id, error);
      return null;
    });

    if (teamId) console.warn("team created for an account that had none", user.id, teamId);
  }
}
