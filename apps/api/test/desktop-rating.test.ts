/**
 * The stars under a finished export, and the one thing that would silence them.
 *
 * This route is the only one in `desktop.ts` that answers an anonymous caller,
 * which is deliberate — exporting needs no account and a rating that demanded
 * one would only ever hear from people who already liked the app enough to make
 * one. So the two things worth pinning are that a signed-out Mac gets through,
 * and that an unbounded caller does not: this posts into a channel, and a route
 * with no credential and no allowance is a way to fill it.
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

const WEBHOOK = "https://hooks.slack.example/events";

interface Options {
  bearer?: boolean;
  install?: string | null;
  webhook?: string | null;
}

let token = "";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["rate_limit", "device_token", "member", "organization", "user"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u1', 'Ana', 'ana@example.com')");

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

/** Only the Slack host, so Better Auth's own calls still go through. */
function interceptSlack(status = 200) {
  const sent: { text: string }[] = [];
  const original = globalThis.fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.startsWith("https://hooks.slack.example")) {
      sent.push(JSON.parse(String(init?.body)) as { text: string });
      return new Response("ok", { status });
    }

    return original(input as RequestInfo, init);
  });

  return sent;
}

async function rate(
  body: unknown,
  { bearer = false, install = "install-uuid", webhook = WEBHOOK }: Options = {},
) {
  const ctx = createExecutionContext();

  const response = await app.fetch(
    new Request("https://api.prequel.sh/v1/desktop/rating", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${token}` } : {}),
        ...(install ? { "x-prequel-install": install } : {}),
      },
      body: JSON.stringify(body),
    }),
    { ...env, SLACK_EVENTS_WEBHOOK_URL: webhook ?? undefined },
    ctx,
  );

  await waitOnExecutionContext(ctx);
  return response;
}

describe("a rating from a Mac nobody has signed in", () => {
  it("still reaches the channel", async () => {
    const sent = interceptSlack();

    const response = await rate({
      rating: 2,
      message: "The zooms were too fast",
      version: "1.2.3",
    });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("2/5");
    expect(sent[0]!.text).toContain("The zooms were too fast");
    expect(sent[0]!.text).toContain("1.2.3");
  });

  it("draws the score as stars, filled and empty", async () => {
    const sent = interceptSlack();

    await rate({ rating: 4 });

    expect(sent[0]!.text).toContain("★★★★☆");
  });

  it("takes a bare star with nothing typed under it", async () => {
    const sent = interceptSlack();

    const response = await rate({ rating: 5 });

    expect(response.status).toBe(200);
    // No empty quote line: a rating sent with the box untouched should not
    // arrive looking like a note that failed to come along.
    expect(sent[0]!.text).not.toContain(">");
  });

  it("keeps a note of several lines in one block", async () => {
    const sent = interceptSlack();

    await rate({ rating: 3, message: "One\nTwo" });

    expect(sent[0]!.text).toContain("> One\n> Two");
  });
});

describe("a rating from a signed-in Mac", () => {
  it("arrives with a name on it", async () => {
    const sent = interceptSlack();

    await rate({ rating: 5 }, { bearer: true });

    expect(sent[0]!.text).toContain("ana@example.com");
  });
});

describe("what it refuses", () => {
  it("refuses a caller with neither a token nor an install", async () => {
    // Nothing to count an allowance against, which is the only state in which
    // this route would be unbounded.
    expect((await rate({ rating: 5 }, { install: null })).status).toBe(400);
  });

  it("refuses a score outside the row of stars", async () => {
    expect((await rate({ rating: 0 })).status).toBe(400);
    expect((await rate({ rating: 6 })).status).toBe(400);
    expect((await rate({ rating: 4.5 })).status).toBe(400);
  });

  it("refuses a note longer than the box can send", async () => {
    expect((await rate({ rating: 5, message: "a".repeat(1_001) })).status).toBe(400);
  });

  it("counts the allowance against the install, not the request", async () => {
    interceptSlack();

    for (let i = 0; i < 30; i += 1) {
      expect((await rate({ rating: 5 })).status).toBe(200);
    }

    expect((await rate({ rating: 5 })).status).toBe(429);
    // A different machine is unaffected — the key is the install, so one
    // install spending its allowance must not close the channel to everyone.
    expect((await rate({ rating: 5 }, { install: "another-uuid" })).status).toBe(200);
  });
});

describe("a rating that cannot be delivered", () => {
  it("says so rather than answering as though it arrived", async () => {
    interceptSlack(403);
    expect((await rate({ rating: 1 })).status).toBe(503);
  });

  it("says so on a deployment with no webhook at all", async () => {
    expect((await rate({ rating: 1 }, { webhook: null })).status).toBe(503);
  });
});
