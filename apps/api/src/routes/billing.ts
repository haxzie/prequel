/**
 * What a team is paying, and the two ways to change it.
 *
 * Reading is open to any member — a plain member seeing "3 of 4 seats used" is
 * how they know why Invite is refusing them. Both writes are owner-or-admin,
 * because both of them spend money.
 *
 * Nothing here changes a plan. Checkout hands back a Dodo URL and the portal
 * hands back a Dodo URL; the subscription row is only ever written by the
 * webhook, so what this app believes about a subscription came from Dodo rather
 * than from an optimistic write next to a redirect the user may never follow.
 */
import { count, eq } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "@prequel/db";

import { createCheckout, portalSession } from "../lib/dodo.ts";
import { entitlement, seatsNeeded } from "../lib/seats.ts";
import { authenticate, requireAdmin, requireTeam, type AppContext } from "../middleware.ts";

const billing = new Hono<AppContext>();

billing.use("*", authenticate, requireTeam);

billing.get("/", async (c) => {
  const db = c.get("db");
  const teamId = c.get("identity").teamId!;

  const [team] = await db
    .select({ plan: schema.organization.plan, quota: schema.organization.storageQuotaBytes })
    .from(schema.organization)
    .where(eq(schema.organization.id, teamId))
    .limit(1);

  const [subscription] = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.teamId, teamId))
    .limit(1);

  const [members] = await db
    .select({ total: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, teamId));

  const seatsUsed = seatsNeeded(members?.total ?? 0);

  return c.json({
    plan: team?.plan ?? "free",
    storageQuotaBytes: team?.quota ?? 0,
    /** Seats in use and seats paid for, both excluding the included one. */
    seatsUsed,
    seatsPurchased: subscription?.seatsPurchased ?? 0,
    /**
     * What the seat count drops to at renewal, when somebody has left and
     * their seat is running out its term. Null when nothing is pending.
     */
    scheduledSeats: subscription?.scheduledSeats ?? null,
    status: subscription?.status ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    /** Set only while a failed renewal is still inside its grace window. */
    graceUntil: subscription?.graceUntil ?? null,
    cancelled: subscription ? subscription.status !== "active" : false,
  });
});

/**
 * A checkout for the team, opened at the size the team already is.
 *
 * Seats are counted from current membership rather than started at zero, so a
 * team that grew while it was free — or that is resubscribing after lapsing —
 * buys what it needs in one transaction. Starting at zero would subscribe them
 * and then immediately charge them again per member, which is two receipts and
 * a support email for something they did once.
 */
billing.post("/checkout", requireAdmin, async (c) => {
  const db = c.get("db");
  const { userId } = c.get("identity");
  const teamId = c.get("identity").teamId!;

  if (await entitlement(db, teamId)) {
    return c.json({ message: "This team already has a subscription.", code: "ALREADY_PRO" }, 409);
  }

  const [user] = await db
    .select({ email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!user) return c.json({ message: "Sign in to continue." }, 401);

  const [members] = await db
    .select({ total: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, teamId));

  // A cancelled subscription leaves its row behind, and with it the Dodo
  // customer. Reusing it keeps one payer's cards and invoices together instead
  // of scattering them over a new customer per resubscribe.
  const [previous] = await db
    .select({ customerId: schema.subscription.dodoCustomerId })
    .from(schema.subscription)
    .where(eq(schema.subscription.teamId, teamId))
    .limit(1);

  const url = await createCheckout(c.env, {
    teamId,
    seats: seatsNeeded(members?.total ?? 0),
    email: user.email,
    name: user.name,
    customerId: previous?.customerId ?? null,
    returnUrl: `${c.env.APP_URL}/app/settings/billing?checkout=done`,
  });

  return c.json({ url });
});

/** Dodo's own portal: card, invoices, cancellation. Everything this app does not do. */
billing.post("/portal", requireAdmin, async (c) => {
  const db = c.get("db");
  const teamId = c.get("identity").teamId!;

  const [subscription] = await db
    .select({ customerId: schema.subscription.dodoCustomerId })
    .from(schema.subscription)
    .where(eq(schema.subscription.teamId, teamId))
    .limit(1);

  if (!subscription) {
    return c.json({ message: "This team has never subscribed.", code: "NO_SUBSCRIPTION" }, 404);
  }

  const url = await portalSession(
    c.env,
    subscription.customerId,
    `${c.env.APP_URL}/app/settings/billing`,
  );

  return c.json({ url });
});

export default billing;
