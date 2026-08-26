/**
 * Seats, and when money changes hands over them.
 *
 * A seat is **capacity a team has bought**, not a live headcount. The Pro
 * product includes one — the owner's — and every member past that is an add-on
 * seat on the same subscription.
 *
 * - Somebody joins and every seat is taken → buy one, charged pro rata now.
 * - Somebody joins and a seat is free → nothing happens. It is already paid for
 *   until the end of the term.
 * - Somebody is removed → their seat is freed but stays bought, with its
 *   release *scheduled* for the next renewal. No mid-term credit.
 * - That freed seat is filled again before renewal → the scheduled release is
 *   cancelled, and it costs nothing.
 *
 * The consequence worth stating: a team that churns a member in and out pays
 * once, and a team that shrinks stops paying at its next renewal rather than
 * immediately. Both follow from seats being capacity.
 *
 * `decide` is pure so the whole of that can be tested without a network, which
 * is where `test/seats.test.ts` lives.
 */
import { count, eq } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";
import type { Env } from "../env.ts";
import { cancelScheduledChange, setSeats } from "./dodo.ts";

/**
 * Storage a Pro team gets for each seat it holds, the included one included.
 *
 * Written to `organization.storageQuotaBytes` whenever seats change, so the
 * upload check in `routes/videos.ts` keeps enforcing one number and never
 * learns that billing exists.
 */
export const QUOTA_PER_SEAT_BYTES = 25 * 1024 * 1024 * 1024;

/** What the schema defaults a team to, and what a lapsed team goes back to. */
export const FREE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** How long a failed renewal keeps working before the team is downgraded. */
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Seats a team needs *beyond* the one the Pro product includes. */
export function seatsNeeded(memberCount: number): number {
  return Math.max(0, memberCount - 1);
}

export function quotaFor(seatsPurchased: number): number {
  return (seatsPurchased + 1) * QUOTA_PER_SEAT_BYTES;
}

export type SeatState = { seatsPurchased: number; scheduledSeats: number | null };

export type SeatAction =
  | { kind: "none" }
  /** Buy up to `seats` now, charged pro rata for the rest of the term. */
  | { kind: "buy"; seats: number }
  /** Release down to `seats`, but not until the next renewal. */
  | { kind: "schedule"; seats: number }
  /** Drop a pending release: the seat it would have freed is occupied again. */
  | { kind: "unschedule" };

/**
 * The single Dodo call a team's current membership implies, or none.
 *
 * At most one call, and derived from state rather than from the event that
 * prompted it — which is what lets a dropped hook, a duplicated webhook and an
 * hourly sweep all run this without compounding.
 */
export function decide(needed: number, state: SeatState): SeatAction {
  // Short of capacity. Buying also drops any scheduled release, which would
  // otherwise take back a seat that has just been paid for.
  if (needed > state.seatsPurchased) return { kind: "buy", seats: needed };

  // Over capacity. Schedule the drop for the renewal, unless that exact drop is
  // already scheduled.
  if (needed < state.seatsPurchased) {
    return state.scheduledSeats === needed ? { kind: "none" } : { kind: "schedule", seats: needed };
  }

  // Exactly at capacity, with a release pending: the freed seat was filled
  // again. Free, and the reason removal never issues a credit.
  if (state.scheduledSeats !== null) return { kind: "unschedule" };

  return { kind: "none" };
}

/**
 * Brings Dodo and the subscription row in line with who is actually in the team.
 *
 * Idempotent, by way of `decide` above: running it twice makes at most one
 * call, and running it after a failure recovers. That is why every hook, the
 * webhook route and the cron all call this same function rather than each
 * adjusting a quantity themselves.
 *
 * Returns quietly when there is no subscription. A free team has no seats to
 * reconcile, and inviting into one is refused before it ever gets here.
 */
export async function reconcileSeats(env: Env, db: Database, teamId: string): Promise<void> {
  const [subscription] = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.teamId, teamId))
    .limit(1);

  if (!subscription) return;

  const [members] = await db
    .select({ total: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, teamId));

  const needed = seatsNeeded(members?.total ?? 0);
  const action = decide(needed, subscription);

  if (action.kind === "none") return;

  const next: Partial<typeof schema.subscription.$inferInsert> = { updatedAt: new Date() };

  if (action.kind === "buy") {
    await setSeats(env, subscription.dodoSubscriptionId, {
      seats: action.seats,
      // The team pays for the remainder of the term, and the seat works now.
      // Dodo re-anchors the renewal date as a side effect of any immediate
      // proration mode — the whole subscription's anniversary moves to today.
      prorationBillingMode: "prorated_immediately",
      effectiveAt: "immediately",
    });

    next.seatsPurchased = action.seats;
    next.scheduledSeats = null;
    // Capacity grew, so the quota grows with it. Written here rather than left
    // for the `plan_changed` webhook so the team can use what it just bought
    // without waiting on a delivery.
    await db
      .update(schema.organization)
      .set({ storageQuotaBytes: quotaFor(action.seats) })
      .where(eq(schema.organization.id, teamId));
  }

  if (action.kind === "schedule") {
    await setSeats(env, subscription.dodoSubscriptionId, {
      seats: action.seats,
      // Nothing is billed or credited now. The lower quantity is simply what
      // renews, which is what "the seat stays bought for the term" means.
      prorationBillingMode: "do_not_bill",
      effectiveAt: "next_billing_date",
    });

    next.scheduledSeats = action.seats;
  }

  if (action.kind === "unschedule") {
    await cancelScheduledChange(env, subscription.dodoSubscriptionId);
    next.scheduledSeats = null;
  }

  await db.update(schema.subscription).set(next).where(eq(schema.subscription.id, subscription.id));
}

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
