/**
 * What a subscription entitles a team to, and for how long after it stops
 * being paid for.
 *
 * This was `seats.ts`, and it held the whole per-seat billing model: a
 * quantity bought from Dodo, reconciled against the member list on every
 * invitation. Teams are single-member now — `auth.ts` says why — so a team
 * needs exactly one seat, for ever, and every part of that model that made a
 * decision has been removed rather than left to run on a number that cannot
 * change. What is left is the two questions the rest of the app actually asks:
 * is this team Pro, and how much may it store.
 */
import { eq } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";

/** What a Pro team may store. One team, one member, one allowance. */
export const PRO_QUOTA_BYTES = 25 * 1024 * 1024 * 1024;

/** What the schema defaults a team to, and what a lapsed team goes back to. */
export const FREE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** How long a failed renewal keeps working before the team is downgraded. */
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The team's subscription, if it currently entitles them to anything.
 *
 * A failed renewal leaves the status at `on_hold` with a grace window on it, and
 * the team keeps Pro for the length of that window — a declined card should not
 * take a library away the same minute. Everything past the window is the cron's
 * job, not this function's.
 */
export async function entitlement(db: Database, teamId: string) {
  const [subscription] = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.teamId, teamId))
    .limit(1);

  if (!subscription) return null;

  const active =
    subscription.status === "active" ||
    (subscription.graceUntil !== null && subscription.graceUntil.getTime() > Date.now());

  return active ? subscription : null;
}
