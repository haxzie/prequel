/**
 * What a team is paying, and the two ways to change it.
 *
 * Both writes are owner-or-admin, because both of them spend money. Reading is
 * open to the whole team, which today is one person.
 *
 * Nothing here changes a plan. Checkout hands back a Dodo URL and the portal
 * hands back a Dodo URL; the subscription and purchase rows are only ever
 * written by the webhook, so what this app believes about a payment came from
 * Dodo rather than from an optimistic write next to a redirect the user may
 * never follow.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "@prequel/db";

import { required } from "../env.ts";
import { createCheckout, portalSession } from "../lib/dodo.ts";
import { customerId, entitlement, purchase } from "../lib/entitlement.ts";
import { trialEndsAt, trialStatus } from "../lib/trial.ts";
import { authenticate, requireAdmin, requireTeam, type AppContext } from "../middleware.ts";

const billing = new Hono<AppContext>();

billing.use("*", authenticate, requireTeam);

billing.get("/", async (c) => {
  const db = c.get("db");
  const { userId, teamId } = c.get("identity");

  /**
   * Three reads for one panel, started together.
   *
   * Every one of them keys off `userId` or `teamId`, both already resolved by
   * the middleware, so none waits on another. Awaited in turn they were three
   * serial hops to D1 — and the dashboard blocks its billing page on this call
   * rather than fetching it from an effect, so the three were the page.
   *
   * The second is one read for one date: the trial is anchored to the account's
   * sign-up and the plan to the team, so this cannot say which of the three
   * states a non-paying team is in without both — and "free" on its own is the
   * label that made a running trial and a lapsed one look identical here.
   */
  const [[team], [account], [subscription]] = await Promise.all([
    db
      .select({ plan: schema.organization.plan, quota: schema.organization.storageQuotaBytes })
      .from(schema.organization)
      .where(eq(schema.organization.id, teamId!))
      .limit(1),

    db
      .select({ createdAt: schema.user.createdAt })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1),

    db.select().from(schema.subscription).where(eq(schema.subscription.teamId, teamId!)).limit(1),
  ]);

  // A valid session for a user who is not there — `/v1/me` documents how that
  // happens. Refused rather than answered with an invented sign-up date, which
  // is what `/v1/desktop/entitlement` does with the same state and for the same
  // reason: a date made up here is a trial verdict made up here.
  if (!account) return c.json({ message: "Sign in to continue." }, 401);

  return c.json({
    plan: team?.plan ?? "free",
    /**
     * The verdict, not the dates behind it.
     *
     * `main/licence.ts` derives its own from facts because it caches them and
     * reads them back offline. This page does not — it is fetched fresh every
     * time it is opened — so it is handed the answer from `lib/trial.ts` rather
     * than being a second place that rounds a countdown.
     */
    trial: trialStatus(team?.plan ?? "free", trialEndsAt(account.createdAt)),
    storageQuotaBytes: team?.quota ?? 0,
    status: subscription?.status ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    /** Set only while a failed renewal is still inside its grace window. */
    graceUntil: subscription?.graceUntil ?? null,
    cancelled: subscription ? subscription.status !== "active" : false,
  });
});

/**
 * A checkout for one of the two products.
 *
 * Which one is asked for by the caller and defaults to Pro, so the dashboard's
 * existing button needs no body. The refusals below are per-product rather than
 * "does this team have anything": somebody holding the lifetime licence buying
 * Pro for the larger allowance is a sale, not a mistake, and refusing it was
 * the shape this endpoint had when there was only one thing to sell.
 */
billing.post("/checkout", requireAdmin, async (c) => {
  const db = c.get("db");
  const { userId } = c.get("identity");
  const teamId = c.get("identity").teamId!;

  const body = (await c.req.json().catch(() => null)) as { plan?: unknown } | null;
  const plan = body?.plan === "lifetime" ? "lifetime" : "pro";

  const [subscription, bought] = await Promise.all([entitlement(db, teamId), purchase(db, teamId)]);

  if (plan === "pro" && subscription) {
    return c.json({ message: "This team already has a subscription.", code: "ALREADY_PRO" }, 409);
  }

  if (plan === "lifetime" && bought) {
    return c.json(
      { message: "This team already owns the lifetime licence.", code: "ALREADY_LIFETIME" },
      409,
    );
  }

  const [user] = await db
    .select({ email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!user) return c.json({ message: "Sign in to continue." }, 401);

  const url = await createCheckout(c.env, {
    teamId,
    productId: required(
      c.env,
      plan === "lifetime" ? "DODOPAYMENT_LIFETIME_PRODUCT_ID" : "DODOPAYMENT_PRO_PRODUCT_ID",
    ),
    email: user.email,
    name: user.name,
    // A cancelled subscription leaves its row behind, and a purchase leaves one
    // for good. Reusing the customer keeps one payer's cards and invoices
    // together instead of scattering them over a new customer per purchase.
    customerId: await customerId(db, teamId),
    returnUrl: `${c.env.APP_URL}/app/settings/billing?checkout=done`,
  });

  return c.json({ url });
});

/**
 * Dodo's own portal: card, invoices, cancellation. Everything this app does not do.
 *
 * Addressed by the customer rather than by the subscription, so it opens for
 * somebody who only ever bought the lifetime licence. They have no subscription
 * row at all, and their receipt is in there.
 */
billing.post("/portal", requireAdmin, async (c) => {
  const db = c.get("db");
  const teamId = c.get("identity").teamId!;

  const customer = await customerId(db, teamId);

  if (!customer) {
    return c.json({ message: "This team has never paid for anything.", code: "NO_CUSTOMER" }, 404);
  }

  const url = await portalSession(c.env, customer, `${c.env.APP_URL}/app/settings/billing`);

  return c.json({ url });
});

export default billing;
