/**
 * What a team has paid for, and what that entitles it to.
 *
 * This was `seats.ts`, and it held the whole per-seat billing model: a
 * quantity bought from Dodo, reconciled against the member list on every
 * invitation. Teams are single-member now — `auth.ts` says why — so a team
 * needs exactly one seat, for ever, and every part of that model that made a
 * decision has been removed rather than left to run on a number that cannot
 * change. What is left is the two questions the rest of the app actually asks:
 * which tier is this team on, and how much may it store.
 *
 * There are two products. Pro is a subscription and lapses; the lifetime
 * licence is a single payment and does not. A team may hold both — somebody who
 * bought the lifetime licence and later subscribed for the larger allowance —
 * which is the reason `resolvePlan` exists rather than each caller deciding.
 */
import { eq } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";

/**
 * The three allowances, in decimal units.
 *
 * Not binary, and the schema default matches. These are printed by
 * `formatBytes`, which is base-1000, so `5 * 1024 ** 3` reaches the dashboard
 * as "5.4 GB" — a number nobody was quoted, sitting beside a price they were.
 *
 * `apps/web/src/lib/pricing.ts` writes the same figures out as English for the
 * pricing page. The two cannot import each other — `apps/web` shares no code
 * with `apps/api` beyond request and response types — so changing one means
 * changing the other.
 */
export const FREE_QUOTA_BYTES = 2 * 1000 ** 3;
export const LIFETIME_QUOTA_BYTES = 5 * 1000 ** 3;
export const PRO_QUOTA_BYTES = 1000 ** 4;

/** How long a failed renewal keeps working before the team is downgraded. */
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type Plan = "free" | "pro" | "lifetime";

const QUOTA: Record<Plan, number> = {
  free: FREE_QUOTA_BYTES,
  lifetime: LIFETIME_QUOTA_BYTES,
  pro: PRO_QUOTA_BYTES,
};

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

/** The lifetime licence, if this team has bought it. It never lapses. */
export async function purchase(db: Database, teamId: string) {
  const [row] = await db
    .select()
    .from(schema.purchase)
    .where(eq(schema.purchase.teamId, teamId))
    .limit(1);

  return row ?? null;
}

/**
 * The tier this team is entitled to right now, from what it has paid for.
 *
 * Order matters: a paying subscriber who also holds the lifetime licence is on
 * Pro, because Pro is the larger allowance and the one they are still being
 * charged for. Losing the subscription drops them to `lifetime`, not to `free`
 * — they still own the thing they bought once.
 */
export async function resolvePlan(db: Database, teamId: string): Promise<Plan> {
  const [subscription, bought] = await Promise.all([entitlement(db, teamId), purchase(db, teamId)]);

  if (subscription) return "pro";
  if (bought) return "lifetime";
  return "free";
}

/**
 * Writes the tier and its quota. **The only place either is set.**
 *
 * Every caller used to spell out its own `.set({ plan, storageQuotaBytes })` —
 * the webhook twice, the cron once — each deciding the pair for itself. With
 * three tiers and a fallback that depends on a second table, that is three
 * places to get the same rule wrong, and the one that would be got wrong is the
 * quiet one: a cancellation dropping a lifetime holder to free.
 *
 * Recomputed from the tables rather than told what to write, so an event that
 * arrives out of order settles on the same answer as the event before it.
 */
export async function applyPlan(db: Database, teamId: string): Promise<Plan> {
  const plan = await resolvePlan(db, teamId);

  await db
    .update(schema.organization)
    .set({ plan, storageQuotaBytes: QUOTA[plan] })
    .where(eq(schema.organization.id, teamId));

  return plan;
}

/**
 * The Dodo customer this team has already paid as, from either product.
 *
 * Reusing it keeps one payer's cards and invoices together instead of
 * scattering them over a new customer per purchase — and it is what lets the
 * billing portal open for somebody who only ever bought the lifetime licence
 * and so has no subscription row at all.
 */
export async function customerId(db: Database, teamId: string): Promise<string | null> {
  const [[subscription], [bought]] = await Promise.all([
    db
      .select({ customerId: schema.subscription.dodoCustomerId })
      .from(schema.subscription)
      .where(eq(schema.subscription.teamId, teamId))
      .limit(1),

    db
      .select({ customerId: schema.purchase.dodoCustomerId })
      .from(schema.purchase)
      .where(eq(schema.purchase.teamId, teamId))
      .limit(1),
  ]);

  return subscription?.customerId ?? bought?.customerId ?? null;
}
