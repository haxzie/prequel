/**
 * Who may spend money, and what stops a free team growing.
 *
 * Two things are asserted here that nothing else in this repo asserted before.
 * The first is a server-side role check — every other route scopes by team
 * alone, and the only thing keeping a plain member from inviting was the
 * dashboard hiding the form, which stops nobody who can open a terminal. The
 * second is the 402 the upgrade modal keys off: if that status ever becomes a
 * 403 the modal stops appearing and the product simply refuses to grow a team
 * with no explanation.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../src/index.ts";
import { deviceToken, sha256 } from "../src/lib/ids.ts";
import { scalar } from "./helpers.ts";

const CHECKOUT_URL = "https://test.dodopayments.com/checkout/session_1";

let ownerToken = "";
let memberToken = "";
let ownerCookie = "";
let memberCookie = "";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of [
    "device_token",
    "session",
    "subscription",
    "invitation",
    "member",
    "organization",
    "user",
  ]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u1', 'Ana', 'ana@example.com')");
  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u2', 'Bo', 'bo@example.com')");
  await env.DB.exec("INSERT INTO organization (id, name, slug) VALUES ('org1', 'Acme', 'acme')");
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'org1', 'u1', 'owner')",
  );
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m2', 'org1', 'u2', 'member')",
  );

  ownerToken = deviceToken();
  memberToken = deviceToken();

  await env.DB.prepare(
    "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d1', ?, 'u1', 'Ana-Mac')",
  )
    .bind(await sha256(ownerToken))
    .run();

  await env.DB.prepare(
    "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d2', ?, 'u2', 'Bo-Mac')",
  )
    .bind(await sha256(memberToken))
    .run();

  ownerCookie = await session("sess1", "u1");
  memberCookie = await session("sess2", "u2");
});

/**
 * A Better Auth session, as a cookie the real handler will accept.
 *
 * The invitation endpoint belongs to the organization plugin, and the gate
 * under test is a hook on that plugin — so the only way to exercise it is
 * through a genuine session. Every other suite here authenticates with a device
 * token, which the plugin's endpoints do not read.
 *
 * The cookie is `<token>.<base64 HMAC-SHA256(secret, token)>`, url-encoded,
 * which is what better-call's `setSignedCookie` writes. Unsigned, Better Auth
 * discards it and the request is simply anonymous — a 401 that looks like the
 * refusal being tested but is not it.
 */
async function session(id: string, userId: string): Promise<string> {
  const token = `token_${id}`;
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;

  await env.DB.prepare(
    `INSERT INTO session (id, token, expires_at, user_id, active_organization_id)
     VALUES (?, ?, ?, ?, 'org1')`,
  )
    .bind(id, token, expires, userId)
    .run();

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));

  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);

  const value = encodeURIComponent(`${token}.${btoa(binary)}`);

  return `better-auth.session_token=${value}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Dodo, answered locally. Only its host is intercepted — see `events.test.ts`. */
function interceptDodo() {
  const sent: { url: string; body: unknown }[] = [];
  const original = globalThis.fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.includes("dodopayments.com")) {
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });

      if (url.includes("/checkouts")) {
        return Response.json({ session_id: "session_1", checkout_url: CHECKOUT_URL });
      }
      if (url.includes("customer-portal")) {
        return Response.json({ link: "https://test.dodopayments.com/portal/1" });
      }
      return Response.json({ ok: true });
    }

    return original(input as RequestInfo, init);
  });

  return sent;
}

async function call(path: string, token: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();

  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    }),
    env,
    ctx,
  );

  await waitOnExecutionContext(ctx);
  return response;
}

async function subscribe({
  status = "active",
  seats = 1,
  graceUntil = null as number | null,
} = {}) {
  await env.DB.prepare(
    `INSERT INTO subscription
       (id, team_id, dodo_subscription_id, dodo_customer_id, status, seats_purchased, grace_until)
     VALUES ('s1', 'org1', 'sub_dodo_1', 'cus_1', ?, ?, ?)`,
  )
    .bind(status, seats, graceUntil)
    .run();

  await env.DB.exec("UPDATE organization SET plan = 'pro' WHERE id = 'org1'");
}

describe("GET /v1/billing", () => {
  it("answers for a team that has never paid", async () => {
    const response = await call("/v1/billing", ownerToken);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: "free",
      seatsUsed: 1,
      seatsPurchased: 0,
      status: null,
    });
  });

  it("is readable by a plain member", async () => {
    // How somebody who is not an admin finds out why Invite is refusing them.
    expect((await call("/v1/billing", memberToken)).status).toBe(200);
  });

  it("reports seats in use separately from seats bought", async () => {
    await subscribe({ seats: 4 });

    await expect((await call("/v1/billing", ownerToken)).json()).resolves.toMatchObject({
      plan: "pro",
      // Two members, so one seat beyond the included one is in use, of four
      // paid for. The gap is what the billing page shows as idle.
      seatsUsed: 1,
      seatsPurchased: 4,
    });
  });
});

describe("POST /v1/billing/checkout", () => {
  it("refuses a plain member", async () => {
    const response = await call("/v1/billing/checkout", memberToken, { method: "POST" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_ADMIN" });
  });

  it("opens checkout at the size the team already is", async () => {
    const sent = interceptDodo();

    const response = await call("/v1/billing/checkout", ownerToken, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: CHECKOUT_URL });

    // Two members, so one add-on seat in the same transaction. Starting at zero
    // would charge them again the moment the subscription activated.
    expect(sent[0]?.body).toMatchObject({
      product_cart: [{ quantity: 1, addons: [{ quantity: 1 }] }],
      metadata: { teamId: "org1" },
    });
  });

  it("carries the team id, which is the only link back from a payment", async () => {
    const sent = interceptDodo();
    await call("/v1/billing/checkout", ownerToken, { method: "POST" });

    expect(sent[0]?.body).toMatchObject({ metadata: { teamId: "org1" } });
  });

  it("reuses the customer of a subscription that lapsed", async () => {
    // Keeps one payer's cards and invoices together across a resubscribe.
    await subscribe({ status: "cancelled", seats: 0 });
    const sent = interceptDodo();

    await call("/v1/billing/checkout", ownerToken, { method: "POST" });

    expect(sent[0]?.body).toMatchObject({ customer: { customer_id: "cus_1" } });
  });

  it("refuses to sell a second subscription to a team that has one", async () => {
    await subscribe();

    const response = await call("/v1/billing/checkout", ownerToken, { method: "POST" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "ALREADY_PRO" });
  });
});

describe("POST /v1/billing/portal", () => {
  it("refuses a plain member", async () => {
    expect((await call("/v1/billing/portal", memberToken, { method: "POST" })).status).toBe(403);
  });

  it("404s for a team that has never subscribed", async () => {
    const response = await call("/v1/billing/portal", ownerToken, { method: "POST" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NO_SUBSCRIPTION" });
  });

  it("hands back a portal link once there is a customer", async () => {
    await subscribe();
    interceptDodo();

    const response = await call("/v1/billing/portal", ownerToken, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      url: "https://test.dodopayments.com/portal/1",
    });
  });
});

describe("inviting", () => {
  /** Better Auth owns the endpoint; the gate is a hook the plugin runs first. */
  async function invite(cookie: string) {
    const ctx = createExecutionContext();

    const response = await app.fetch(
      new Request("https://api.prequel.sh/api/auth/organization/invite-member", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          // Better Auth refuses a state-changing call with no `Origin` —
          // `MISSING_OR_NULL_ORIGIN`, a 403 that looks exactly like the
          // permission refusal below and is not one. Real browsers always send
          // it; `new Request` does not.
          origin: env.APP_URL,
        },
        body: JSON.stringify({ email: "cy@example.com", role: "member", organizationId: "org1" }),
      }),
      env,
      ctx,
    );

    await waitOnExecutionContext(ctx);
    return response;
  }

  const invitations = () => scalar<number>(env.DB.prepare("SELECT COUNT(*) FROM invitation"));

  it("refuses with 402 when the team has no subscription", async () => {
    // The status matters as much as the refusal: the dashboard opens the
    // upgrade modal on 402 and shows a plain error message on anything else.
    const response = await invite(ownerCookie);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ code: "SUBSCRIPTION_REQUIRED" });
    expect(await invitations()).toBe(0);
  });

  it("still refuses once a subscription has lapsed past its grace window", async () => {
    await subscribe({ status: "cancelled", seats: 2 });

    expect((await invite(ownerCookie)).status).toBe(402);
    expect(await invitations()).toBe(0);
  });

  it("allows it while a failed renewal is still inside its grace window", async () => {
    // A declined card must not stop a team working for the week it has to fix
    // the card in.
    await subscribe({
      status: "on_hold",
      seats: 1,
      graceUntil: Math.floor(Date.now() / 1000) + 60 * 60,
    });

    expect((await invite(ownerCookie)).status).toBe(200);
    expect(await invitations()).toBe(1);
  });

  it("lets a paying team invite", async () => {
    await subscribe({ seats: 1 });
    interceptDodo();

    expect((await invite(ownerCookie)).status).toBe(200);
    expect(await invitations()).toBe(1);
  });

  it("refuses a plain member even on a paying team", async () => {
    // The plugin's own rule, asserted because the dashboard hiding the form is
    // not what enforces it.
    await subscribe({ seats: 1 });
    interceptDodo();

    expect((await invite(memberCookie)).status).toBe(403);
    expect(await invitations()).toBe(0);
  });
});
