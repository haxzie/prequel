/**
 * The bug report box, and the two ways it can lie to the person using it.
 *
 * It can say "Sent" over a message that never reached the channel — a webhook
 * revoked in Slack, or a deployment that was never given one — which turns the
 * button into a shredder that thanks you. And it can throw a report away at the
 * door: a device token is the only credential the app holds, so a route that
 * only understood cookies would 401 every Mac in the field.
 *
 * Neither failure is visible from the app, which is why both are pinned here.
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
 * Catches the webhook call and lets everything else through.
 *
 * A blanket stub would take Better Auth's own outbound calls with it, the way
 * `events.test.ts` explains — only the Slack host is intercepted.
 */
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

/**
 * `webhook: null` is how a caller says "no webhook", not `undefined`.
 *
 * A destructuring default fires on `undefined`, so passing that would quietly
 * hand the test the configured URL it was trying to take away — and the case
 * being tested would pass for the wrong reason.
 */
async function send(body: unknown, { bearer = true, webhook = WEBHOOK }: Options = {}) {
  const ctx = createExecutionContext();

  const response = await app.fetch(
    new Request("https://api.prequel.sh/v1/desktop/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    { ...env, SLACK_EVENTS_WEBHOOK_URL: webhook ?? undefined },
    ctx,
  );

  await waitOnExecutionContext(ctx);
  return response;
}

describe("a report from a signed-in Mac", () => {
  it("reaches the events channel with a name to reply to", async () => {
    const sent = interceptSlack();

    const response = await send({
      message: "The blade cuts in the wrong place",
      version: "0.0.32",
    });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    // The address, because a report nobody can answer is a complaint.
    expect(sent[0]!.text).toContain("ana@example.com");
    expect(sent[0]!.text).toContain("The blade cuts in the wrong place");
    // The build, which is the line nobody remembers to include by hand.
    expect(sent[0]!.text).toContain("0.0.32");
  });

  it("fences the log after the words, so the report reads first", async () => {
    const sent = interceptSlack();

    await send({ message: "Export failed", log: "12:00 [error] writer refused -11823" });

    const text = sent[0]!.text;
    expect(text.indexOf("Export failed")).toBeLessThan(text.indexOf("writer refused"));
    expect(text).toContain("```\n12:00 [error] writer refused -11823\n```");
  });

  it("takes a report with no log at all", async () => {
    const sent = interceptSlack();

    await send({ message: "Just a note" });

    // No empty fence: a report sent with the switch off should not arrive
    // looking like one whose log failed to read.
    expect(sent[0]!.text).not.toContain("```");
  });

  it("keeps a report of several lines in one block", async () => {
    const sent = interceptSlack();

    await send({ message: "One\nTwo" });

    expect(sent[0]!.text).toContain("> One\n> Two");
  });
});

describe("a report that cannot be delivered", () => {
  it("says so rather than answering as though it arrived", async () => {
    // The failure this route exists to avoid: a 200 here is a dialog saying
    // "Sent" over a message that went nowhere, and the person walks away
    // believing somebody is reading it.
    interceptSlack(403);

    const response = await send({ message: "Something is broken" });

    expect(response.status).toBe(503);
  });

  it("says so on a deployment with no webhook at all", async () => {
    const sent = interceptSlack();

    const response = await send({ message: "Something is broken" }, { webhook: null });

    expect(response.status).toBe(503);
    expect(sent).toHaveLength(0);
  });
});

describe("what it refuses", () => {
  it("refuses a Mac that is not signed in", async () => {
    const response = await send({ message: "Something is broken" }, { bearer: false });
    expect(response.status).toBe(401);
  });

  it("refuses an empty report", async () => {
    // Whitespace as well as nothing: a textarea that has been tabbed through
    // holds a newline, and posting that to the channel says nothing.
    expect((await send({ message: "" })).status).toBe(400);
    expect((await send({ message: "   \n  " })).status).toBe(400);
  });

  it("refuses a report longer than the channel can hold", async () => {
    expect((await send({ message: "a".repeat(4_001) })).status).toBe(400);
  });

  it("refuses a log larger than the app would ever send", async () => {
    // The app sends 12 KB and this takes 16, so the refusal only ever means a
    // caller that is not the app.
    const response = await send({ message: "Something is broken", log: "a".repeat(16_001) });
    expect(response.status).toBe(400);
  });

  it("stops somebody holding the key down in the box", async () => {
    interceptSlack();

    for (let i = 0; i < 10; i += 1) {
      expect((await send({ message: `Report ${String(i)}` })).status).toBe(200);
    }

    expect((await send({ message: "One more" })).status).toBe(429);
  });
});
