/**
 * The hourly sweep, which exists for exactly two things.
 *
 * Everything else about billing is driven by a webhook, because Dodo announces
 * what it does. These two have nobody to announce them:
 *
 * - A grace window running out. A failed renewal fires `subscription.on_hold`
 *   once; the moment seven days later when that team stops being Pro is not an
 *   event anywhere, it is just a timestamp going past.
 * - A seat sync that never happened. The organization hooks run reconciliation
 *   after the response, so a Dodo outage during an invitation acceptance loses
 *   it silently. This finds the disagreement and settles it.
 */
import { and, count, eq, isNotNull, lt, ne } from "drizzle-orm";

import { schema } from "@prequel/db";

import { database } from "./db.ts";
import type { Env } from "./env.ts";
import { decide, FREE_QUOTA_BYTES, reconcileSeats, seatsNeeded } from "./lib/seats.ts";

export async function scheduled(env: Env): Promise<void> {
  const db = database(env);

  await expireGrace(db);
  await settleSeats(env, db);
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
      .set({ seatsPurchased: 0, scheduledSeats: null, graceUntil: null, updatedAt: new Date() })
      .where(eq(schema.subscription.id, subscription.id));

    // Members are left alone, the same as on an outright cancellation. They
    // keep reading the library and cannot invite anyone into it.
    await db
      .update(schema.organization)
      .set({ plan: "free", storageQuotaBytes: FREE_QUOTA_BYTES })
      .where(eq(schema.organization.id, subscription.teamId));

    console.warn("grace expired, team downgraded", subscription.teamId);
  }
}

/**
 * Seat counts that disagree with the member list.
 *
 * `decide` is run here rather than calling `reconcileSeats` for every active
 * team, so an hour where nothing changed costs one query instead of one Dodo
 * request per paying customer.
 */
async function settleSeats(env: Env, db: Database): Promise<void> {
  const teams = await db
    .select({
      teamId: schema.subscription.teamId,
      seatsPurchased: schema.subscription.seatsPurchased,
      scheduledSeats: schema.subscription.scheduledSeats,
      members: count(schema.member.id),
    })
    .from(schema.subscription)
    .leftJoin(schema.member, eq(schema.member.organizationId, schema.subscription.teamId))
    .where(eq(schema.subscription.status, "active"))
    .groupBy(schema.subscription.id);

  for (const team of teams) {
    if (decide(seatsNeeded(team.members), team).kind === "none") continue;

    // One failure must not stop the sweep: the next team's seats have nothing
    // to do with this one's, and the alternative is one bad subscription
    // freezing reconciliation for everybody.
    await reconcileSeats(env, db, team.teamId).catch((error: unknown) => {
      console.error("scheduled seat reconciliation failed", team.teamId, error);
    });
  }
}
