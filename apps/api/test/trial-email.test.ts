/**
 * The email a lapsed trial gets, and the four people it must not go to.
 *
 * Every interesting case here is a date boundary or somebody who should be
 * left alone, and both are invisible in production until somebody is written
 * to who should not have been. So `sweepLapsedTrials` takes its own `now`:
 * a test that had to wait seven days to reach a boundary is a test nobody runs.
 *
 * The assertions are about *who was written to*, not about row counts. A
 * duplicate send is the failure a recipient actually experiences, and it is
 * the one the primary key on `trial_email` exists to make impossible.
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { database } from "../src/db.ts";
import { DAILY_CRON, scheduled } from "../src/cron.ts";
import { sweepLapsedTrials } from "../src/lib/trial-email.ts";
import { scalar } from "./helpers.ts";
// The raw text of the deploy config, so the branch in `cron.ts` can be checked
// against the schedule that actually fires.
import wrangler from "../wrangler.jsonc?raw";

const DAY = 24 * 60 * 60 * 1000;

/** The moment every case is measured from. Fixed, so nothing depends on when
 *  the suite runs. */
const NOW = Date.UTC(2026, 10, 19, 9, 0, 0);

/** Seconds, which is what `unixepoch()` columns hold. */
const at = (ms: number) => Math.floor(ms / 1000);

/** A sign-up whose trial ended `days` ago. */
const endedDaysAgo = (days: number) => at(NOW - (7 + days) * DAY);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** Addresses SES was asked to write to, in order. */
let sent: string[] = [];
/** The raw SES payloads, for the test that reads the message itself. */
let bodies: string[] = [];

beforeEach(async () => {
  for (const table of ["trial_email", "email_preference", "member", "organization", "user"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  sent = [];
  bodies = [];
  stubSes();
});

/**
 * Stands in for SES, recording who was written to.
 *
 * `aws4fetch` signs the request before it sends it, so what arrives here is a
 * `Request` and `init` is undefined — the body has to come off the request
 * rather than the second argument. Getting that wrong does not fail loudly: the
 * stub answers 200, nothing is recorded, and every assertion about who was
 * emailed is quietly empty.
 */
function stubSes(status: (nth: number) => number = () => 200): void {
  let nth = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (!request.url.includes("amazonaws.com")) return new Response("{}", { status: 200 });

    nth += 1;
    const code = status(nth);
    const raw = await request.text();
    if (code >= 400) return new Response("rejected", { status: code });

    bodies.push(raw);
    const body = JSON.parse(raw) as { Destination?: { ToAddresses?: string[] } };
    sent.push(...(body.Destination?.ToAddresses ?? []));
    return new Response(JSON.stringify({ MessageId: "test" }), { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * One account with a team, as the app creates them.
 *
 * `signedUpAt` is the only thing a trial is made of, so it is the only knob
 * most of these tests turn.
 */
async function account(
  id: string,
  {
    signedUpAt = endedDaysAgo(0.5),
    plan = "free",
    marketing = null as boolean | null,
    team = true,
  } = {},
): Promise<void> {
  await env.DB.prepare("INSERT INTO user (id, name, email, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, `User ${id}`, `${id}@example.com`, signedUpAt)
    .run();

  if (team) {
    await env.DB.prepare(
      "INSERT INTO organization (id, name, slug, plan, created_by) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(`org-${id}`, `Team ${id}`, `slug-${id}`, plan, id)
      .run();
    await env.DB.prepare(
      "INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'owner')",
    )
      .bind(`mem-${id}`, `org-${id}`, id)
      .run();
  }

  if (marketing !== null) {
    await env.DB.prepare("INSERT INTO email_preference (user_id, marketing) VALUES (?, ?)")
      .bind(id, marketing ? 1 : 0)
      .run();
  }
}

const sweep = (now = NOW) => sweepLapsedTrials(env, database(env), now);

const claims = () => scalar<number>(env.DB.prepare("SELECT COUNT(*) FROM trial_email"));

describe("a trial that has just ended", () => {
  it("is written to once", async () => {
    await account("ana");

    await sweep();

    expect(sent).toEqual(["ana@example.com"]);
  });

  it("is not written to twice, however often the sweep runs", async () => {
    await account("ana");

    await sweep();
    await sweep();
    await sweep(NOW + DAY);

    expect(sent).toEqual(["ana@example.com"]);
    expect(await claims()).toBe(1);
  });

  /**
   * The reason the window is three days rather than one.
   *
   * A run that never happened — a deploy, an incident, a schedule edited at
   * the wrong hour — must not mean nobody inside that day is ever written to.
   * With a one-day window this account is invisible by the time anything runs
   * again, and nothing anywhere remembers it was skipped.
   */
  it("is still caught two days after the run that should have had it", async () => {
    await account("ana", { signedUpAt: endedDaysAgo(2) });

    await sweep();

    expect(sent).toEqual(["ana@example.com"]);
  });
});

describe("who is left alone", () => {
  it("somebody whose trial has not ended yet", async () => {
    // A day left: the trial ends tomorrow, so this is not a lapsed account.
    await account("ana", { signedUpAt: at(NOW - 6 * DAY) });

    await sweep();

    expect(sent).toEqual([]);
  });

  it("somebody whose trial ended long ago", async () => {
    // Past the catch-up window. They have had their email or they predate the
    // sweep entirely; either way this is not the day to ask them again.
    await account("ana", { signedUpAt: endedDaysAgo(30) });

    await sweep();

    expect(sent).toEqual([]);
  });

  it("somebody who already pays", async () => {
    await account("ana", { plan: "pro" });
    await account("bob", { plan: "lifetime" });

    await sweep();

    expect(sent).toEqual([]);
  });

  it("somebody who turned these emails off", async () => {
    await account("ana", { marketing: false });

    await sweep();

    expect(sent).toEqual([]);
  });

  it("but not somebody who merely has a preference row saying yes", async () => {
    // No row means subscribed, and so does a row that says so. Both have to
    // reach the send, or turning the checkbox on and off again would opt
    // somebody out for good.
    await account("ana", { marketing: true });

    await sweep();

    expect(sent).toEqual(["ana@example.com"]);
  });

  it("somebody whose account has no team yet", async () => {
    // A broken account rather than a lapsed one — the hourly sweep is already
    // repairing it. Asking them to pay for an account that does not work yet
    // is the wrong email at the wrong moment.
    await account("ana", { team: false });

    await sweep();

    expect(sent).toEqual([]);
  });
});

describe("when SES refuses", () => {
  /**
   * The deliberate half of the trade in `sendOne`.
   *
   * The claim is written before the send, so a failed send is not retried. The
   * alternative — send, then record it — loses the record on exactly the
   * failures that happen after the message is already on its way, and emails
   * somebody a second time. Being asked twice to pay is the failure a person
   * sees; a missed one is ours to find in the log.
   */
  it("does not try that address again", async () => {
    await account("ana");
    stubSes(() => 400);

    await expect(sweep()).resolves.toBeUndefined();
    expect(await claims()).toBe(1);

    // A second run, with a working SES, still leaves them alone.
    sent = [];
    stubSes();
    await sweep(NOW + DAY);
    expect(sent).toEqual([]);
  });

  it("still writes to everybody after them", async () => {
    await account("ana");
    await account("bob");

    stubSes((nth) => (nth === 1 ? 400 : 200));

    await sweep();

    // One of the two failed; the other still went.
    expect(sent).toHaveLength(1);
  });
});

describe("the message", () => {
  it("carries the upgrade link and a way to stop the emails", async () => {
    await account("ana");

    await sweep();

    const message = JSON.parse(bodies[0] ?? "{}") as {
      Content: { Simple: { Body: { Html: { Data: string }; Text: { Data: string } } } };
    };
    const { Html, Text } = message.Content.Simple.Body;

    for (const part of [Html.Data, Text.Data]) {
      expect(part).toContain("/app/settings/billing");
      expect(part).toContain("/app/settings");
    }
    // The default shell footer is for a sign-in link, which is the only thing
    // anybody gets without asking. This one has to say how to stop it.
    expect(Html.Data).not.toContain("you can ignore it safely");
  });
});

describe("the schedule", () => {
  /**
   * The quiet failure this whole branch has.
   *
   * `DAILY_CRON` has to match `wrangler.jsonc` exactly. If it does not, every
   * run takes the hourly branch and nobody is ever emailed — and nothing
   * anywhere says so, because the hourly work succeeds.
   */
  it("sends on the daily cron and not on the hourly one", async () => {
    await account("ana");

    await scheduled(env, "0 * * * *");
    expect(sent).toEqual([]);

    await scheduled(env, DAILY_CRON);
    expect(sent).toEqual(["ana@example.com"]);
  });

  it("is an expression wrangler actually fires", () => {
    // Read as text rather than parsed: the file is JSONC and carries comments,
    // which `JSON.parse` refuses. Both the top-level triggers and the
    // production ones have to list it, or the schedule exists in dev and not
    // where it matters.
    const triggers = [...wrangler.matchAll(/"crons"\s*:\s*\[([^\]]*)\]/g)].map((m) => m[1] ?? "");

    expect(triggers).toHaveLength(2);
    for (const list of triggers) expect(list).toContain(`"${DAILY_CRON}"`);
  });
});
