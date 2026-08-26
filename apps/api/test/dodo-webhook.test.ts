/**
 * The one endpoint that can set a team's plan, and it has no credential.
 *
 * A POST here decides whether a team is Pro and how much storage it gets, and
 * the only thing between that and the open internet is an HMAC over the raw
 * body. So the failures worth pinning are the quiet ones: a signature computed
 * over a re-serialised body, a replayed delivery that downgrades a team which
 * has since resubscribed, and an unhandled event type answered with a 4xx that
 * makes Dodo retry until it abandons the endpoint.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../src/index.ts";
import { scalar } from "./helpers.ts";

const SECRET = env.DODOPAYMENT_WEBHOOK_SECRET!;

/**
 * Catches the seat calls activation makes, and lets everything else through.
 *
 * `subscription.active` reconciles seats on the way out, so every delivery in
 * this file would otherwise reach the real Dodo host. A blanket `fetch` stub is
 * not an option — Better Auth and R2 presigning share this Worker's `fetch`.
 */
function interceptDodo() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const original = globalThis.fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.includes("dodopayments.com")) {
      sent.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json({ ok: true });
    }

    return original(input as RequestInfo, init);
  });

  return sent;
}

let dodo: { url: string; method: string; body: unknown }[] = [];

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["webhook_event", "subscription", "member", "organization", "user"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u1', 'Ana', 'ana@example.com')");
  await env.DB.exec("INSERT INTO organization (id, name, slug) VALUES ('org1', 'Acme', 'acme')");
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'org1', 'u1', 'owner')",
  );

  dodo = interceptDodo();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The same construction the route verifies, so a mismatch is a real mismatch. */
async function sign(id: string, timestamp: number, body: string): Promise<string> {
  const raw = atob(SECRET.replace(/^whsec_/, ""));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);

  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );

  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);

  return `v1,${btoa(binary)}`;
}

function envelope(type: string, data: Record<string, unknown> = {}) {
  return JSON.stringify({
    business_id: "biz_1",
    type,
    timestamp: new Date().toISOString(),
    data: {
      payload_type: "Subscription",
      subscription_id: "sub_dodo_1",
      status: type === "subscription.active" ? "active" : "active",
      product_id: "pdt_test_pro",
      quantity: 1,
      addons: [],
      customer: { customer_id: "cus_1", email: "ana@example.com" },
      next_billing_date: "2027-08-25T00:00:00Z",
      cancel_at_next_billing_date: false,
      metadata: { teamId: "org1" },
      scheduled_change: null,
      ...data,
    },
  });
}

async function deliver(
  body: string,
  { id = crypto.randomUUID(), timestamp = Math.floor(Date.now() / 1000), signature = "" } = {},
) {
  const ctx = createExecutionContext();

  const response = await app.fetch(
    new Request("https://api.prequel.sh/v1/webhooks/dodo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": signature || (await sign(id, timestamp, body)),
      },
      body,
    }),
    env,
    ctx,
  );

  await waitOnExecutionContext(ctx);
  return response;
}

const plan = () =>
  scalar<string>(env.DB.prepare("SELECT plan FROM organization WHERE id = 'org1'"));

const quota = () =>
  scalar<number>(env.DB.prepare("SELECT storage_quota_bytes FROM organization WHERE id = 'org1'"));

describe("verification", () => {
  it("accepts a correctly signed delivery", async () => {
    expect((await deliver(envelope("subscription.active"))).status).toBe(200);
  });

  it("rejects a body that changed after signing", async () => {
    const id = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sign(id, timestamp, envelope("subscription.active"));

    // The same event, re-serialised. This is exactly what parsing the body and
    // signing the result would produce, and it must not verify.
    const tampered = envelope("subscription.cancelled");

    expect((await deliver(tampered, { id, timestamp, signature })).status).toBe(401);
    expect(await plan()).toBe("free");
  });

  it("rejects a delivery whose timestamp is too old to be genuine", async () => {
    const body = envelope("subscription.active");
    const id = crypto.randomUUID();
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;

    expect(
      (await deliver(body, { id, timestamp: stale, signature: await sign(id, stale, body) }))
        .status,
    ).toBe(401);
  });

  it("rejects a delivery with no signature at all", async () => {
    expect(
      (await deliver(envelope("subscription.active"), { signature: "v1,nonsense" })).status,
    ).toBe(401);
  });

  it("does not record an unverified delivery as seen", async () => {
    // Otherwise one forged POST suppresses the genuine delivery behind it,
    // which is a team that paid and never became Pro.
    const id = crypto.randomUUID();
    const body = envelope("subscription.active");

    await deliver(body, { id, signature: "v1,nonsense" });
    expect(await plan()).toBe("free");

    expect((await deliver(body, { id })).status).toBe(200);
    expect(await plan()).toBe("pro");
  });
});

describe("subscription events", () => {
  it("makes the team Pro and sizes the quota to its seats", async () => {
    await deliver(envelope("subscription.active", { addons: [{ addon_id: "a", quantity: 2 }] }));

    expect(await plan()).toBe("pro");
    // Three seats: the two bought plus the one the product includes.
    expect(await quota()).toBe(3 * 25 * 1024 * 1024 * 1024);
    expect(await scalar(env.DB.prepare("SELECT seats_purchased FROM subscription"))).toBe(2);
  });

  it("settles a seat count that does not match the team on activation", async () => {
    await deliver(envelope("subscription.active", { addons: [{ addon_id: "a", quantity: 2 }] }));

    // The team is one person holding two bought seats, so reconciliation
    // schedules the surplus for release rather than refunding it — and does it
    // without the delivery waiting on Dodo.
    const change = dodo.find((call) => call.url.includes("/change-plan"));

    expect(change?.body).toMatchObject({
      addons: [],
      proration_billing_mode: "do_not_bill",
      effective_at: "next_billing_date",
    });
  });

  it("ignores a repeat of the same delivery", async () => {
    const id = crypto.randomUUID();
    const body = envelope("subscription.active");

    await deliver(body, { id });
    await deliver(envelope("subscription.cancelled"), { id });

    // The second call carried a cancellation but the same id. Acting on it
    // would downgrade a team that is paying.
    expect(await plan()).toBe("pro");
  });

  it("keeps the team on Pro while a failed renewal is inside its grace window", async () => {
    await deliver(envelope("subscription.active"));
    await deliver(envelope("subscription.on_hold", { status: "on_hold" }));

    expect(await plan()).toBe("pro");

    const grace = await scalar<number>(env.DB.prepare("SELECT grace_until FROM subscription"));
    expect(grace).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("downgrades on cancellation without touching the member list", async () => {
    await deliver(envelope("subscription.active", { addons: [{ addon_id: "a", quantity: 3 }] }));
    await deliver(envelope("subscription.cancelled", { status: "cancelled" }));

    expect(await plan()).toBe("free");
    expect(await quota()).toBe(2 * 1024 * 1024 * 1024);
    expect(await scalar(env.DB.prepare("SELECT COUNT(*) FROM member"))).toBe(1);
    // The customer survives the cancellation: it is what a resubscribe reuses.
    expect(await scalar(env.DB.prepare("SELECT dodo_customer_id FROM subscription"))).toBe("cus_1");
  });

  it("takes the seat count from Dodo on a plan change", async () => {
    await deliver(envelope("subscription.active"));
    await deliver(
      envelope("subscription.plan_changed", {
        addons: [{ addon_id: "a", quantity: 4 }],
        scheduled_change: { addons: [{ addon_id: "a", quantity: 2 }] },
      }),
    );

    expect(await scalar(env.DB.prepare("SELECT seats_purchased FROM subscription"))).toBe(4);
    expect(await scalar(env.DB.prepare("SELECT scheduled_seats FROM subscription"))).toBe(2);
  });

  it("lets a lapsed team resubscribe onto its existing row", async () => {
    await deliver(envelope("subscription.active"));
    await deliver(envelope("subscription.cancelled", { status: "cancelled" }));
    await deliver(envelope("subscription.active"));

    expect(await plan()).toBe("pro");
    // The unique constraint on `team_id` is why this is an upsert. An insert
    // would 500 on a second purchase that has already been charged for.
    expect(await scalar(env.DB.prepare("SELECT COUNT(*) FROM subscription"))).toBe(1);
  });

  it("answers 200 to an event it does not handle", async () => {
    // A 4xx here makes Dodo retry until it gives up on the endpoint, taking the
    // events that do matter with it.
    expect((await deliver(envelope("payment.succeeded"))).status).toBe(200);
  });

  it("ignores an update for a subscription it has never seen", async () => {
    // Dodo does not promise ordering, so this can arrive before `active`.
    expect((await deliver(envelope("subscription.updated"))).status).toBe(200);
    expect(await scalar(env.DB.prepare("SELECT COUNT(*) FROM subscription"))).toBe(0);
  });
});
