/**
 * The ways the mailing list goes wrong without anybody noticing.
 *
 * Three of them, and all three produce a list that looks fine:
 *
 * It writes when it should not — a fork or a preview deployment rewriting
 * contacts on the real list because an absent key was read as "use the default"
 * rather than as "do nothing".
 *
 * It replaces where it meant to merge. `POST /v1/contacts` empties every
 * property it does not mention, so a plan change sent as a `POST` silently
 * drops whatever else the contact carried, and the only symptom is a segment
 * that stops matching anybody weeks later.
 *
 * And it takes a request down with it: a key rotated in Mails answers 401 for
 * ever after, and a sign-up that 500s because of it would be the integration
 * breaking the product it reports on.
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe as suite, expect, it, vi } from "vitest";

import { database } from "../src/db.ts";
import type { Env } from "../src/env.ts";
import { createContact, setSubscribed, syncPlan, updateContact } from "../src/lib/mails.ts";

const BASE = "https://mails.example";

/** Only the three fields `lib/mails.ts` reads. */
function mails(overrides: Partial<Env> = {}): Env {
  return { MAILS_API_URL: BASE, MAILS_API_KEY: "test-key", ...overrides } as Env;
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | undefined;
}

/**
 * Catches anything addressed at Mails and lets everything else through.
 *
 * A blanket `fetch` stub is not an option here for the reason
 * `dodo-webhook.test.ts` gives: Better Auth and R2 presigning share this
 * Worker's `fetch`, and the D1 reads below go through the same runtime.
 */
function intercept(status: number | ((method: string) => number) = 200) {
  const calls: Call[] = [];
  const original = globalThis.fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.startsWith(BASE)) {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        authorization: new Headers(init?.headers).get("authorization") ?? undefined,
      });
      return new Response("", { status: typeof status === "function" ? status(method) : status });
    }

    return original(input as RequestInfo, init);
  });

  return calls;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

suite("a deployment with no Mails key", () => {
  it("writes nothing at all", async () => {
    const calls = intercept();

    // Both halves are needed, and each missing one on its own is silence. A URL
    // with no key would send an unauthenticated request; a key with no URL
    // would send one to `undefined/v1/contacts`.
    await createContact({} as Env, { email: "ada@example.com", name: "Ada" });
    await createContact(mails({ MAILS_API_KEY: "" }), { email: "ada@example.com" });
    await createContact(mails({ MAILS_API_URL: "" }), { email: "ada@example.com" });

    expect(calls).toHaveLength(0);
  });
});

suite("creating a contact for a new account", () => {
  it("posts the address, the first name and a free plan", async () => {
    const calls = intercept();
    const createdAt = new Date("2026-03-04T05:06:07.000Z");

    await createContact(mails(), { email: "ada@example.com", name: "Ada Lovelace", createdAt });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts`);
    expect(calls[0]!.authorization).toBe("Bearer test-key");
    expect(calls[0]!.body).toEqual({
      email: "ada@example.com",
      firstName: "Ada",
      properties: {
        name: "Ada Lovelace",
        // Stated rather than left out, so a segment on `plan` matches an
        // account from its first day and not only once a webhook has been
        // through it.
        plan: "free",
        mrr: 0,
        signedUpAt: "2026-03-04T05:06:07.000Z",
      },
    });
  });

  it("takes the first token of whatever the provider called them", async () => {
    const calls = intercept();

    // A magic-link sign-up has the address as the name, and some providers hand
    // over one word. Neither may reach a greeting as a blank.
    await createContact(mails(), { email: "a@example.com", name: "ada@example.com" });
    await createContact(mails(), { email: "b@example.com", name: "Ada" });
    await createContact(mails(), { email: "c@example.com", name: "   " });

    const names = calls.map((call) => (call.body as { firstName?: string }).firstName);
    expect(names).toEqual(["ada@example.com", "Ada", undefined]);
  });

  it("names the list only when one is configured", async () => {
    const calls = intercept();

    await createContact(mails(), { email: "a@example.com" });
    await createContact(mails({ MAILS_LIST_ID: "lst_abc" }), { email: "b@example.com" });

    expect(calls[0]!.body).not.toHaveProperty("lists");
    expect(calls[1]!.body).toMatchObject({ lists: ["lst_abc"] });
  });
});

suite("a plan change", () => {
  /**
   * The load-bearing one. `POST` replaces the stored properties object, so a
   * plan update sent that way drops every key it does not mention — including
   * anything a campaign or an import put there. Nothing fails; the contact is
   * simply emptied.
   */
  it("patches rather than posting, so other properties survive", async () => {
    const calls = intercept();

    await updateContact(mails(), "ada@example.com", { plan: "pro", mrr: 9 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts/ada%40example.com`);
    expect(calls[0]!.body).toEqual({ properties: { plan: "pro", mrr: 9 } });
  });

  it("escapes the address into the path", async () => {
    const calls = intercept();

    // A `+` is legal in a local part and is a space once it is in a URL path
    // read as a query, which would address a contact that does not exist and
    // answer 404 for a person who is on the list.
    await updateContact(mails(), "ada+news@example.com", { plan: "pro" });

    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts/ada%2Bnews%40example.com`);
  });

  it("counts the lifetime licence as no monthly revenue", async () => {
    const db = database(env);
    const calls = intercept();

    // One charge that does not recur. Billing $39 as MRR would overstate it by
    // the whole of that amount every month for ever.
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u_life', 'Ada', 'life@example.com', 1, 1)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO organization (id, name, slug, created_at) VALUES ('t_life', 'Ada', 'ada-life', 1)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_life', 't_life', 'u_life', 'owner', 1)",
    ).run();

    await syncPlan(mails(), db, "t_life", "lifetime");

    expect(calls[0]!.body).toEqual({ properties: { plan: "lifetime", mrr: 0 } });
  });

  it("writes to the team's owner, and says nothing for a team with nobody in it", async () => {
    const db = database(env);
    const calls = intercept();

    await env.DB.prepare(
      "INSERT INTO organization (id, name, slug, created_at) VALUES ('t_empty', 'Empty', 'empty', 1)",
    ).run();

    // Reachable for a team whose only account was deleted. There is no address
    // to write to, which is not an error and must not be a request either.
    expect(await syncPlan(mails(), db, "t_empty", "pro")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

suite("subscribing and unsubscribing", () => {
  it("posts to the endpoint the direction names", async () => {
    const calls = intercept();

    await setSubscribed(mails(), "ada@example.com", false);
    await setSubscribed(mails(), "ada@example.com", true);

    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/v1/contacts/ada%40example.com/unsubscribe`,
      `${BASE}/v1/contacts/ada%40example.com/resubscribe`,
    ]);
    expect(calls.every((call) => call.method === "POST")).toBe(true);
  });

  /**
   * Read by the one caller that is a person waiting rather than something being
   * told. A toggle that says "Saved" over a request Mails refused is how
   * somebody comes to be sent email they switched off.
   */
  it("reports a refusal rather than swallowing it", async () => {
    intercept(401);
    expect(await setSubscribed(mails(), "ada@example.com", false)).toBe(false);
  });
});

suite("Mails being unreachable", () => {
  it("swallows a refusal rather than failing the sign-up that caused it", async () => {
    intercept(500);

    // What matters is that it does not throw: this runs inside the Better Auth
    // `user.create` hook, after the row is written, so throwing would turn a
    // successful sign-up into an error page for somebody who does now have an
    // account. The boolean is reported for `syncPlan`'s fallback to read; the
    // hook itself ignores it.
    await expect(createContact(mails(), { email: "ada@example.com" })).resolves.toBe(false);
  });

  it("swallows a network failure too", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(BASE)) throw new Error("no route to host");
      return original(input as RequestInfo, init);
    });

    await expect(createContact(mails(), { email: "ada@example.com" })).resolves.toBe(false);
    expect(await updateContact(mails(), "ada@example.com", { plan: "pro" })).toBe(false);
  });
});

/**
 * The gap that the live API's behaviour revealed.
 *
 * `PATCH` answers 404 `Contact not found` for an address Mails does not hold,
 * and it does not create one. `createContact` swallows its failures by design,
 * so an address missed at sign-up is missed for good — and every account that
 * predates this integration is in exactly that state. Without the fallback,
 * the first thing most contacts would meet is a 404 on the one event worth
 * knowing about.
 */
suite("a plan change for somebody Mails has never heard of", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM member WHERE id = 'm_new'").run();
    await env.DB.prepare("DELETE FROM organization WHERE id = 't_new'").run();
    await env.DB.prepare("DELETE FROM user WHERE id = 'u_new'").run();
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u_new', 'Ada Lovelace', 'new@example.com', 1760000000, 1)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO organization (id, name, slug, created_at) VALUES ('t_new', 'Ada', 'ada-new', 1)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_new', 't_new', 'u_new', 'owner', 1)",
    ).run();
  });

  it("creates the contact on the plan it is already on", async () => {
    const db = database(env);
    const calls = intercept((method) => (method === "PATCH" ? 404 : 200));

    expect(await syncPlan(mails(), db, "t_new", "pro")).toBe(true);

    expect(calls.map((call) => call.method)).toEqual(["PATCH", "POST"]);
    // The created contact carries the plan that was being set, not the `free`
    // a sign-up would have written — otherwise the fallback would record
    // somebody who just paid as being on nothing.
    expect(calls[1]!.body).toMatchObject({
      email: "new@example.com",
      firstName: "Ada",
      properties: { plan: "pro", mrr: 9 },
    });
  });

  it("does not create one on any other refusal", async () => {
    const db = database(env);
    // A 401 is a rotated key and a 500 is Mails being unwell. Creating on
    // either would replace the properties of a contact that does exist, which
    // is the one thing `POST` must never be used for.
    for (const code of [401, 429, 500]) {
      const calls = intercept(code);
      expect(await syncPlan(mails(), db, "t_new", "pro")).toBe(false);
      expect(calls.map((call) => call.method)).toEqual(["PATCH"]);
    }
  });

  it("does not create one on a deployment with no Mails", async () => {
    const db = database(env);
    const calls = intercept();

    // `undefined` rather than a number, so "no answer at all" can never be
    // mistaken for a 404 and drive a create against nothing.
    expect(await syncPlan({} as Env, db, "t_new", "pro")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
