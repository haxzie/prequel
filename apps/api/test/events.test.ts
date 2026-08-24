/**
 * Analytics that attributes events to the wrong person is worse than none.
 *
 * Nothing about this pipeline fails loudly. A `distinct_id` computed from the
 * wrong field, a missing `$anon_distinct_id`, a batch sent without the
 * `environment` property — every one of them is a 202 to the client, a 200 from
 * PostHog and a dashboard full of numbers that are quietly wrong. So the rules
 * are asserted here rather than inferred from a chart six weeks later.
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
import { toCaptureBatch, type EventContext, type Subject } from "../src/lib/posthog.ts";

const TOKEN = "phc_test_token";

const CONTEXT: EventContext = {
  app: "desktop",
  version: "0.0.2",
  platform: "darwin",
  arch: "arm64",
  osVersion: "25.6.0",
  packaged: true,
  locale: "en-GB",
};

const INSTALL = "11111111-2222-3333-4444-555555555555";

let token = "";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["device_token", "member", "organization", "user"]) {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Records what would have gone to PostHog and lets everything else through.
 *
 * A blanket `fetch` stub is not an option: this Worker's other outbound calls
 * are R2 presigning and SES, and Better Auth reaches for the network of its own
 * accord. Only the analytics host is intercepted.
 */
function interceptPostHog(status = 200) {
  const sent: { api_key: string; batch: Record<string, unknown>[] }[] = [];
  const original = globalThis.fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.includes("i.posthog.com")) {
      sent.push(JSON.parse(String(init?.body)));
      return new Response("ok", { status });
    }

    return original(input as RequestInfo, init);
  });

  return sent;
}

async function post(
  events: unknown[],
  { signedIn = false, install = INSTALL as string | null, posthog = TOKEN } = {},
) {
  const ctx = createExecutionContext();

  const response = await app.fetch(
    new Request("https://api.prequel.sh/v1/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signedIn ? { authorization: `Bearer ${token}` } : {}),
        ...(install ? { "x-prequel-install": install } : {}),
      },
      body: JSON.stringify({ context: CONTEXT, events }),
    }),
    { ...env, POSTHOG_PROJECT_TOKEN: posthog },
    ctx,
  );

  await waitOnExecutionContext(ctx);
  return response;
}

describe("toCaptureBatch", () => {
  const subject = (over: Partial<Subject> = {}): Subject => ({
    userId: null,
    teamId: null,
    installId: INSTALL,
    person: null,
    ...over,
  });

  it("files an unauthenticated app's events under its install", () => {
    const [event] = toCaptureBatch([{ event: "app_launched" }], CONTEXT, subject(), "production");

    expect(event?.distinct_id).toBe(`install_${INSTALL}`);
  });

  it("files a signed-in app's events under the account, with the team attached", () => {
    const [event] = toCaptureBatch(
      [{ event: "recording_started" }],
      CONTEXT,
      subject({ userId: "u1", teamId: "org1" }),
      "production",
    );

    // The account rather than the Mac: somebody with two Macs is one person.
    expect(event?.distinct_id).toBe("u1");
    expect(event?.properties["$groups"]).toEqual({ team: "org1" });
  });

  it("drops everything when there is neither a user nor an install", () => {
    // No credential and no header is a caller with nothing to attribute events
    // to. Inventing an id would fill the project with persons of one event each.
    expect(
      toCaptureBatch(
        [{ event: "app_launched" }],
        CONTEXT,
        subject({ installId: null }),
        "production",
      ),
    ).toEqual([]);
  });

  it("merges the anonymous install into the account on sign-in", () => {
    const batch = toCaptureBatch(
      [{ event: "signed_in" }],
      CONTEXT,
      subject({ userId: "u1", teamId: "org1", person: { email: "ana@example.com", name: "Ana" } }),
      "production",
    );

    // Without the `$identify`, everything before sign-in stays on a separate
    // person for ever and the install-to-account funnel cannot be drawn at all.
    expect(batch[0]?.event).toBe("$identify");
    expect(batch[0]?.properties["$anon_distinct_id"]).toBe(`install_${INSTALL}`);
    expect(batch[0]?.properties["$set"]).toMatchObject({ email: "ana@example.com", name: "Ana" });
    expect(batch[1]?.event).toBe("signed_in");
  });

  it("issues no merge for a sign-in it cannot join to an install", () => {
    const batch = toCaptureBatch(
      [{ event: "signed_in" }],
      CONTEXT,
      subject({ userId: "u1", installId: null }),
      "production",
    );

    expect(batch.map((event) => event.event)).toEqual(["signed_in"]);
  });

  it("stamps the context and environment on every event", () => {
    const batch = toCaptureBatch(
      [{ event: "app_launched" }, { event: "recording_started" }],
      CONTEXT,
      subject(),
      "development",
    );

    for (const event of batch) {
      expect(event.properties["app_version"]).toBe("0.0.2");
      // One PostHog project holds both deployments. This property is the only
      // thing keeping `pnpm dev` out of every insight.
      expect(event.properties["environment"]).toBe("development");
    }
  });

  it("does not let a client overwrite what the server asserts", () => {
    const [event] = toCaptureBatch(
      [{ event: "app_launched", properties: { environment: "production", app_version: "9.9.9" } }],
      CONTEXT,
      subject(),
      "development",
    );

    expect(event?.properties["environment"]).toBe("development");
    expect(event?.properties["app_version"]).toBe("0.0.2");
  });

  it("writes person properties on the launch event only", () => {
    const batch = toCaptureBatch(
      [{ event: "app_launched" }, { event: "recording_started" }],
      CONTEXT,
      subject(),
      "production",
    );

    // PostHog bills for person processing. Rewriting the same three values on
    // every recording is how that gets expensive without anything looking wrong.
    expect(batch[0]?.properties["$set"]).toBeDefined();
    expect(batch[1]?.properties["$set"]).toBeUndefined();
  });
});

describe("POST /v1/events", () => {
  it("forwards an anonymous batch under the install id", async () => {
    const sent = interceptPostHog();

    const response = await post([{ event: "app_launched", properties: { first_launch: true } }]);

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.api_key).toBe(TOKEN);
    expect(sent[0]?.batch[0]?.["distinct_id"]).toBe(`install_${INSTALL}`);
  });

  it("resolves the account from a device token", async () => {
    const sent = interceptPostHog();

    await post([{ event: "recording_started" }], { signedIn: true });

    expect(sent[0]?.batch[0]?.["distinct_id"]).toBe("u1");
  });

  it("puts the email on the merge from the database, not from the client", async () => {
    const sent = interceptPostHog();

    await post([{ event: "signed_in", properties: { email: "attacker@example.com" } }], {
      signedIn: true,
    });

    const identify = sent[0]?.batch.find((event) => event["event"] === "$identify");
    expect((identify?.["properties"] as Record<string, unknown>)["$set"]).toMatchObject({
      email: "ana@example.com",
    });
  });

  it("sends nothing, and still succeeds, when there is no token", async () => {
    const sent = interceptPostHog();

    const response = await post([{ event: "app_launched" }], { posthog: "" });

    // A deployment that has not been configured is silent, not broken.
    expect(response.status).toBe(202);
    expect(sent).toHaveLength(0);
  });

  it("succeeds even when PostHog refuses the batch", async () => {
    interceptPostHog(500);

    // The app does not retry and has nothing useful to do with a failure. A
    // client that surfaced this to a user would be reporting our outage as their
    // recording going wrong.
    expect((await post([{ event: "app_launched" }])).status).toBe(202);
  });

  it("refuses a batch past the cap", async () => {
    const sent = interceptPostHog();

    const response = await post(Array.from({ length: 60 }, () => ({ event: "recording_started" })));

    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("refuses one event carrying unbounded properties", async () => {
    const sent = interceptPostHog();

    const response = await post([
      { event: "recording_started", properties: { note: "x".repeat(9 * 1024) } },
    ]);

    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("drops a batch it cannot attribute to anybody", async () => {
    const sent = interceptPostHog();

    const response = await post([{ event: "app_launched" }], { install: null });

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(0);
  });
});
