/**
 * What Dodo Payments tells this app, and the only thing that writes a plan.
 *
 * Its own router with no auth middleware, like `routes/public.ts` — the caller
 * is a server, has no cookie and no device token, and proves itself with a
 * signature instead. Everything else in `/v1` is behind `authenticate`, so
 * mounting this inside one of those routers would 401 every delivery.
 *
 * Endpoint to register in Dodo:
 *
 *   production   https://api.prequel.sh/v1/webhooks/dodo
 *   development  <tunnel>/v1/webhooks/dodo
 *
 * Subscribed to the `subscription.*` events handled below, **and to
 * `payment.succeeded`** — which is the only thing Dodo sends for a one-off
 * product, and so the only way the lifetime licence is ever granted. Without
 * that subscription in Dodo's dashboard the lifetime product takes money and
 * this app never hears about it.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "@prequel/db";

import { database, type Database } from "../../db.ts";
import { type Env, required } from "../../env.ts";
import {
  type DodoPayment,
  type DodoSubscription,
  getPayment,
  verifyWebhook,
  type WebhookEnvelope,
} from "../../lib/dodo.ts";
import { applyPlan, GRACE_MS } from "../../lib/entitlement.ts";
import { id } from "../../lib/ids.ts";

const dodo = new Hono<{ Bindings: Env }>();

dodo.post("/", async (c) => {
  // The raw bytes, before anything parses them. The signature covers the body
  // exactly as it was sent, and `JSON.parse` followed by `JSON.stringify`
  // reorders keys and drops whitespace — a round trip that verifies against
  // nothing while looking completely correct.
  const raw = await c.req.text();

  const verified = await verifyWebhook(
    required(c.env, "DODOPAYMENT_WEBHOOK_SECRET"),
    {
      id: c.req.header("webhook-id"),
      timestamp: c.req.header("webhook-timestamp"),
      signature: c.req.header("webhook-signature"),
    },
    raw,
  );

  // 401 and no record of it. An unverified body must not mark its id as seen,
  // or one forged delivery would suppress the real one behind it.
  if (!verified) return c.json({ message: "Bad signature." }, 401);

  const event = JSON.parse(raw) as WebhookEnvelope;
  const db = database(c.env);

  // The insert is the idempotency check. Dodo retries until it gets a 2xx, so
  // the same event arrives more than once; a duplicated activation is harmless
  // but a duplicated `cancelled` arriving after a resubscribe would downgrade a
  // team that is paying, and nothing downstream would notice.
  const first = await db
    .insert(schema.webhookEvent)
    .values({ id: c.req.header("webhook-id")!, type: event.type })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvent.id });

  if (first.length === 0) return c.json({ ok: true, duplicate: true });

  await handle(db, c.env, event);

  // Always 200 once verified, including for an event with no handler. A 4xx on
  // something we simply do not care about makes Dodo retry it until it gives
  // up on the endpoint entirely, taking the events we do care about with it.
  return c.json({ ok: true });
});

async function handle(db: Database, env: Env, event: WebhookEnvelope): Promise<void> {
  // Every branch below but one is about a subscription, and the exception is
  // handled first so the narrowing holds for the rest.
  if (event.data.payload_type === "Payment") {
    if (event.type === "payment.succeeded") await redeem(db, env, event.data);
    return;
  }

  const subscription = event.data;
  const teamId = subscription.metadata?.teamId;

  switch (event.type) {
    case "subscription.active": {
      // The only event that can create the row: it is the first one after a
      // checkout, and `metadata.teamId` set on that checkout is the sole link
      // between a payment and the team that made it.
      if (!teamId) {
        console.error("subscription.active with no teamId", subscription.subscription_id);
        return;
      }

      await activate(db, teamId, subscription);
      return;
    }

    case "subscription.renewed": {
      // The term rolled over and the card went through, so whatever grace
      // window was open is closed.
      await update(db, subscription, { graceUntil: null });
      return;
    }

    case "subscription.plan_changed":
    case "subscription.updated": {
      // Dodo owns the status, not this app. A change made through the customer
      // portal, or by hand in the dashboard, only reaches the database here.
      await update(db, subscription, {});
      return;
    }

    case "subscription.on_hold":
    case "subscription.paused":
    case "subscription.failed": {
      // A renewal that did not go through. The team keeps Pro for the length of
      // the grace window; the cron in `index.ts` is what eventually acts on it.
      await update(db, subscription, { graceUntil: new Date(Date.now() + GRACE_MS) });
      return;
    }

    case "subscription.cancelled":
    case "subscription.expired": {
      await downgrade(db, subscription);
      return;
    }

    default:
      return;
  }
}

async function activate(
  db: Database,
  teamId: string,
  subscription: DodoSubscription,
): Promise<void> {
  const row = {
    teamId,
    dodoSubscriptionId: subscription.subscription_id,
    dodoCustomerId: subscription.customer.customer_id,
    status: subscription.status,
    currentPeriodEnd: subscription.next_billing_date
      ? new Date(subscription.next_billing_date)
      : null,
    graceUntil: null,
    updatedAt: new Date(),
  };

  // Upsert on the team rather than insert. A team that lapsed and resubscribed
  // has a row already, and the unique constraint on `team_id` is what would
  // otherwise turn their second purchase into a 500 and a charge with nothing
  // to show for it.
  await db
    .insert(schema.subscription)
    .values({ id: id("sub"), ...row })
    .onConflictDoUpdate({ target: schema.subscription.teamId, set: row });

  await applyPlan(db, teamId);
}

/**
 * A one-off charge that turns out to be the lifetime licence.
 *
 * **Two guards, and both are load-bearing.** Dodo sends `payment.succeeded` for
 * every charge it makes, which includes the first charge of a new subscription
 * and every renewal after it. Granting a licence on the event alone would hand
 * one to every subscriber, every month, and nothing downstream would notice:
 * the team is already `pro`, the quota is already the larger of the two, and
 * the only symptom is a purchase row that outlives a cancellation they wanted.
 *
 * The row's existence *is* the entitlement, so it is `applyPlan` that decides
 * what the team ends up on — a lifetime licence bought by somebody already
 * subscribed leaves them on Pro, and surfaces the moment they cancel.
 */
async function redeem(db: Database, env: Env, payment: DodoPayment): Promise<void> {
  // A renewal, or the opening charge of a subscription. Either way the
  // `subscription.*` events are what describe it, and this is not a purchase.
  if (payment.subscription_id) return;

  const lifetime = required(env, "DODOPAYMENT_LIFETIME_PRODUCT_ID");

  /**
   * The cart, fetched only if the delivery did not bring one.
   *
   * A live `payment.succeeded` **does** carry `product_cart`, verified against
   * Dodo's test mode. The fallback is here because Dodo serves two shapes of a
   * payment and the other one — the summary in `GET /payments` — omits the
   * field entirely, so its presence on a webhook is a property of the payload
   * version rather than of the event.
   *
   * Worth one conditional request because of how the absence would fail: an
   * undefined cart reads as "not the lifetime product", which is indistinguishable
   * from a genuine no-op. The charge succeeds, the licence is never granted, and
   * nothing anywhere reports it. Re-deriving the cart is cheaper than being told
   * about that by the person who paid.
   *
   * Only reached for a payment outside a subscription, so no renewal pays for it.
   */
  const cart =
    payment.product_cart ??
    (await getPayment(env, payment.payment_id)
      .then((full) => full.product_cart)
      .catch((error: unknown) => {
        // Left to Dodo's retry rather than swallowed. This is the one branch
        // where giving up silently loses a licence somebody paid for.
        console.error("could not read the cart for", payment.payment_id, error);
        throw error;
      }));

  const bought = cart?.some((line) => line.product_id === lifetime);

  // Some other product, or a cart Dodo did not send. Not an error — a business
  // may sell things this app knows nothing about — so it is a silent no-op
  // rather than something that makes Dodo retry.
  if (!bought) return;

  const teamId = payment.metadata?.teamId;

  if (!teamId) {
    console.error("payment.succeeded for the lifetime product with no teamId", payment.payment_id);
    return;
  }

  // `onConflictDoNothing` on the team, matching the upsert in `activate`. The
  // licence can only be held once, and a retry that violated the constraint
  // would 500 a delivery that has nothing left to do.
  await db
    .insert(schema.purchase)
    .values({
      id: id("pur"),
      teamId,
      dodoPaymentId: payment.payment_id,
      dodoCustomerId: payment.customer.customer_id,
      productId: lifetime,
    })
    .onConflictDoNothing({ target: schema.purchase.teamId });

  await applyPlan(db, teamId);
}

/**
 * Writes what an event says about a subscription that already exists.
 *
 * Addressed by Dodo's subscription id rather than by `metadata.teamId`, because
 * only the events that follow a checkout are guaranteed to carry the metadata,
 * and the id is on every one of them.
 */
async function update(
  db: Database,
  subscription: DodoSubscription,
  fields: { graceUntil?: Date | null },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.dodoSubscriptionId, subscription.subscription_id))
    .limit(1);

  // Nothing to update. Either the `active` event has not landed yet — Dodo does
  // not promise an order — or this subscription belongs to something else
  // entirely. Both are a no-op rather than an error, and the retry after the
  // first one finds the row.
  if (!existing) return;

  await db
    .update(schema.subscription)
    .set({
      status: subscription.status,
      currentPeriodEnd: subscription.next_billing_date
        ? new Date(subscription.next_billing_date)
        : existing.currentPeriodEnd,
      ...(fields.graceUntil !== undefined ? { graceUntil: fields.graceUntil } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.subscription.id, existing.id));
}

/**
 * The subscription is over.
 *
 * The library is left exactly where it is. Deleting videos over a declined card
 * would make cancelling destructive, and a team that resubscribes a week later
 * would have nothing to come back to. What changes is the quota, so nothing new
 * goes up until the card does.
 */
export async function downgrade(db: Database, subscription: DodoSubscription): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.dodoSubscriptionId, subscription.subscription_id))
    .limit(1);

  if (!existing) return;

  await db
    .update(schema.subscription)
    .set({ status: subscription.status, graceUntil: null, updatedAt: new Date() })
    .where(eq(schema.subscription.id, existing.id));

  // Recomputed rather than set to `free`. A team that also holds the lifetime
  // licence falls back to that, not to nothing — they still own what they
  // bought once, and this is the line that would otherwise take it away.
  await applyPlan(db, existing.teamId);
}

export default dodo;
