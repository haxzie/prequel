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
 * Subscribed to the `subscription.*` events handled below. Payment events carry
 * nothing this needs — the subscription events already say what a payment did.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "@prequel/db";

import { database, type Database } from "../../db.ts";
import { type Deferrable, type Env, required } from "../../env.ts";
import { type DodoSubscription, verifyWebhook, type WebhookEnvelope } from "../../lib/dodo.ts";
import { FREE_QUOTA_BYTES, GRACE_MS, quotaFor, reconcileSeats } from "../../lib/seats.ts";
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
  // the same event arrives more than once; a duplicated seat sync is harmless
  // but a duplicated `cancelled` arriving after a resubscribe would downgrade a
  // team that is paying, and nothing downstream would notice.
  const first = await db
    .insert(schema.webhookEvent)
    .values({ id: c.req.header("webhook-id")!, type: event.type })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvent.id });

  if (first.length === 0) return c.json({ ok: true, duplicate: true });

  await handle(c.env, db, event, c.executionCtx);

  // Always 200 once verified, including for an event with no handler. A 4xx on
  // something we simply do not care about makes Dodo retry it until it gives
  // up on the endpoint entirely, taking the events we do care about with it.
  return c.json({ ok: true });
});

async function handle(
  env: Env,
  db: Database,
  event: WebhookEnvelope,
  ctx: Deferrable,
): Promise<void> {
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

      // Membership can have moved between checkout and this arriving — an
      // invitation accepted in the meantime. Reconciling now buys the seat that
      // was missed rather than leaving the team a member over its capacity.
      //
      // Caught, not awaited. The plan is already written; a Dodo call failing
      // here must not turn a successful payment into a retry, and the hourly
      // sweep settles the seat count either way.
      ctx.waitUntil(
        reconcileSeats(env, db, teamId).catch((error: unknown) => {
          console.error("seat reconciliation after activation failed", teamId, error);
        }),
      );
      return;
    }

    case "subscription.renewed": {
      // The term rolled over, so any scheduled release has now happened and
      // Dodo's quantity is the truth about what renewed.
      await update(db, subscription, {
        seatsPurchased: seatsOf(subscription),
        scheduledSeats: null,
        graceUntil: null,
        quota: true,
      });
      return;
    }

    case "subscription.plan_changed":
    case "subscription.updated": {
      // Dodo owns the quantity, not this app. A seat bought through the
      // customer portal, or an adjustment made by hand in the dashboard, only
      // reaches the database here.
      await update(db, subscription, {
        seatsPurchased: seatsOf(subscription),
        scheduledSeats: scheduledSeatsOf(subscription),
        quota: true,
      });
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

/** The seat add-on's quantity, or zero when the cart has no add-on at all. */
function seatsOf(subscription: DodoSubscription): number {
  return subscription.addons?.reduce((total, addon) => total + addon.quantity, 0) ?? 0;
}

/** The quantity a pending change will drop to, or null when none is pending. */
function scheduledSeatsOf(subscription: DodoSubscription): number | null {
  const scheduled = subscription.scheduled_change;
  if (!scheduled) return null;

  return scheduled.addons?.reduce((total, addon) => total + addon.quantity, 0) ?? 0;
}

async function activate(
  db: Database,
  teamId: string,
  subscription: DodoSubscription,
): Promise<void> {
  const seats = seatsOf(subscription);

  const row = {
    teamId,
    dodoSubscriptionId: subscription.subscription_id,
    dodoCustomerId: subscription.customer.customer_id,
    status: subscription.status,
    seatsPurchased: seats,
    scheduledSeats: scheduledSeatsOf(subscription),
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

  await db
    .update(schema.organization)
    .set({ plan: "pro", storageQuotaBytes: quotaFor(seats) })
    .where(eq(schema.organization.id, teamId));
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
  fields: {
    seatsPurchased?: number;
    scheduledSeats?: number | null;
    graceUntil?: Date | null;
    quota?: boolean;
  },
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
      ...(fields.seatsPurchased !== undefined ? { seatsPurchased: fields.seatsPurchased } : {}),
      ...(fields.scheduledSeats !== undefined ? { scheduledSeats: fields.scheduledSeats } : {}),
      ...(fields.graceUntil !== undefined ? { graceUntil: fields.graceUntil } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.subscription.id, existing.id));

  if (fields.quota && fields.seatsPurchased !== undefined) {
    await db
      .update(schema.organization)
      .set({ storageQuotaBytes: quotaFor(fields.seatsPurchased) })
      .where(eq(schema.organization.id, existing.teamId));
  }
}

/**
 * The subscription is over.
 *
 * Members are left exactly where they are. Ejecting everyone but the owner
 * would enforce the one-included-seat rule to the letter and take a team's
 * library away from three people over one declined card; they keep reading,
 * they cannot invite, and the storage quota is the free one again.
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
    .set({
      status: subscription.status,
      seatsPurchased: 0,
      scheduledSeats: null,
      graceUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.subscription.id, existing.id));

  await db
    .update(schema.organization)
    .set({ plan: "free", storageQuotaBytes: FREE_QUOTA_BYTES })
    .where(eq(schema.organization.id, existing.teamId));
}

export default dodo;
