/**
 * The switch on the settings screen, and the one way it lies.
 *
 * The suppression list in Mails is what actually stops a send; the row in D1 is
 * our copy of it, kept so the settings screen can render without a third-party
 * request in front of a page load. So the write order is the whole correctness
 * of this route: Mails first, our row only once it has agreed. Reversed, the
 * dashboard says "off" to somebody who then keeps receiving the mail they
 * switched off, and our own copy is the only thing claiming otherwise.
 *
 * Pinned here because nothing about that failure is visible from either side.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe as suite, expect, it, vi } from "vitest";

import app from "../src/index.ts";
import { deviceToken, sha256 } from "../src/lib/ids.ts";
import { scalar } from "./helpers.ts";

const BASE = "https://mails.example";

let token = "";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["email_preference", "device_token", "member", "organization", "user"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u1', 'Ana', 'ana@example.com')");
  await env.DB.exec("INSERT INTO organization (id, name, slug) VALUES ('org1', 'Acme', 'acme')");
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'org1', 'u1', 'owner')",
  );

  token = deviceToken();
  await env.DB.prepare(
    "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d1', ?, 'u1', 'Ana-Mac')",
  )
    .bind(await sha256(token))
    .run();
});

afterEach(() => vi.unstubAllGlobals());

/** The bindings a configured deployment has, which the pool deliberately lacks. */
const configured = { ...env, MAILS_API_URL: BASE, MAILS_API_KEY: "test-key" };

function intercept(status = 200) {
  const calls: { url: string; method: string }[] = [];
  const original = globalThis.fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(BASE)) {
      calls.push({ url, method: init?.method ?? "GET" });
      return new Response("", { status });
    }
    return original(input as RequestInfo, init);
  });

  return calls;
}

async function call(path: string, init: RequestInit = {}, bindings: typeof env = env) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    }),
    bindings,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

const stored = () =>
  scalar<number>(env.DB.prepare("SELECT marketing FROM email_preference WHERE user_id = 'u1'"));

const set = (marketing: unknown, bindings: typeof env = env) =>
  call(
    "/v1/me/emails",
    {
      method: "PUT",
      body: JSON.stringify({ marketing }),
      headers: { "content-type": "application/json" },
    },
    bindings,
  );

suite("what /v1/me says about email", () => {
  it("reports an account with no row as subscribed", async () => {
    // No row is the state of every account that predates the table, and of
    // every new one. The absence is a real answer rather than something to
    // backfill, so the route defaults it and nothing downstream has to.
    const body = await (await call("/v1/me")).json<{ emails: { marketing: boolean } }>();
    expect(body.emails.marketing).toBe(true);
    expect(await stored()).toBeUndefined();
  });

  it("reports what was chosen once there is a row", async () => {
    await set(false);
    const body = await (await call("/v1/me")).json<{ emails: { marketing: boolean } }>();
    expect(body.emails.marketing).toBe(false);
  });
});

suite("turning product email off", () => {
  it("tells Mails before writing our own copy", async () => {
    const calls = intercept();

    const response = await set(false, configured);

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      { url: `${BASE}/v1/contacts/ana%40example.com/unsubscribe`, method: "POST" },
    ]);
    expect(await stored()).toBe(0);
  });

  it("resubscribes on the way back", async () => {
    const calls = intercept();

    await set(false, configured);
    await set(true, configured);

    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/v1/contacts/ana%40example.com/unsubscribe`,
      `${BASE}/v1/contacts/ana%40example.com/resubscribe`,
    ]);
    expect(await stored()).toBe(1);
  });

  /**
   * The one that matters. A row written over a refused request is a dashboard
   * that disagrees with what is actually being sent, and nothing would ever
   * reconcile the two.
   */
  it("writes nothing at all when Mails refuses", async () => {
    intercept(401);

    const response = await set(false, configured);

    expect(response.status).toBe(502);
    expect(await stored()).toBeUndefined();
  });

  /**
   * A deployment with no Mails key — a fork, or development. Nothing is sending
   * them email either way, so the switch has to work rather than 502 on a
   * service that was never configured.
   */
  it("records the preference on a deployment with no Mails at all", async () => {
    const calls = intercept();

    const response = await set(false);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(await stored()).toBe(0);
  });
});

suite("a malformed request", () => {
  it("refuses anything that is not a boolean rather than unsubscribing", async () => {
    const calls = intercept();

    // An absent or mistyped field read as falsy would unsubscribe somebody on a
    // bad request — and for an address that has since bounced, Mails will not
    // let the settings screen undo it.
    for (const value of [undefined, null, "false", 0, {}]) {
      expect((await set(value, configured)).status).toBe(400);
    }

    expect(calls).toHaveLength(0);
    expect(await stored()).toBeUndefined();
  });

  it("refuses a body that is not JSON", async () => {
    const response = await call(
      "/v1/me/emails",
      { method: "PUT", body: "not json", headers: { "content-type": "application/json" } },
      configured,
    );

    expect(response.status).toBe(400);
  });
});

suite("the route is behind the same door as the rest of /v1/me", () => {
  it("refuses a caller with no token", async () => {
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request("https://api.prequel.sh/v1/me/emails", {
        method: "PUT",
        body: JSON.stringify({ marketing: false }),
      }),
      configured,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(await stored()).toBeUndefined();
  });
});
