/**
 * The trial's edges, and the two payloads the dashboard reads them from.
 *
 * `main/licence.test.ts` pins the same boundaries on the desktop side. Both
 * exist because every one of them is a case nobody exercises by hand — the last
 * hour of the fourteenth day, the hour after it, a paying team whose trial ended
 * months ago — and getting one wrong produces a dashboard that looks right in
 * every manual check and tells somebody their trial has run out on a date nobody
 * thought to set the clock to.
 *
 * The endpoint tests are here for a different reason: `plan` alone cannot tell a
 * running trial from a lapsed one, and for a while the dashboard showed both of
 * them the same card offering fourteen free days.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../src/index.ts";
import { deviceToken, sha256 } from "../src/lib/ids.ts";
import { TRIAL_DAYS, trialEndsAt, trialStatus } from "../src/lib/trial.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 26, 12, 0, 0);

describe("trialStatus", () => {
  it("is a trial while the fourteen days are running", () => {
    expect(trialStatus("free", NOW + 6 * DAY, NOW)).toEqual({
      status: "trial",
      daysLeft: 6,
      endsAt: NOW + 6 * DAY,
    });
  });

  it("rounds a part-day up, so the last day is never reported as none left", () => {
    // Ten minutes left is still a day somebody can export in. Reporting zero
    // here reads as "it has ended" beside an app that still works — and the
    // sidebar would count down to a "0 days left" that is not a state.
    expect(trialStatus("free", NOW + 10 * 60 * 1000, NOW).daysLeft).toBe(1);
  });

  it("expires on the instant, not the day after", () => {
    expect(trialStatus("free", NOW, NOW).status).toBe("expired");
    expect(trialStatus("free", NOW - 1, NOW).status).toBe("expired");
    expect(trialStatus("free", NOW + 1, NOW).status).toBe("trial");
  });

  it("ignores the trial entirely once the team is paying", () => {
    // The one that matters most: a subscriber whose trial ran out long ago must
    // never be shown an upgrade card, and `endsAt` keeps moving into the past
    // for the whole life of the account.
    expect(trialStatus("pro", NOW - 400 * DAY, NOW)).toEqual({
      status: "paid",
      daysLeft: 0,
      endsAt: NOW - 400 * DAY,
    });
  });

  it("dates the end from the sign-up", () => {
    expect(trialEndsAt(new Date(NOW))).toBe(NOW + TRIAL_DAYS * DAY);
  });
});

let token = "";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["device_token", "subscription", "member", "organization", "user"]) {
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

/** Moves the account's sign-up, which is the only thing the trial hangs off. */
async function signedUpDaysAgo(days: number) {
  await env.DB.prepare("UPDATE \"user\" SET created_at = ? WHERE id = 'u1'")
    .bind(Math.floor((Date.now() - days * DAY) / 1000))
    .run();
}

async function get(path: string) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

interface Trial {
  status: string;
  daysLeft: number;
  endsAt: number;
}

describe("the trial in the dashboard's payloads", () => {
  it("counts down on /v1/me while the trial is running", async () => {
    await signedUpDaysAgo(10);

    const { trial } = (await (await get("/v1/me")).json()) as { trial: Trial };

    expect(trial.status).toBe("trial");
    expect(trial.daysLeft).toBe(4);
  });

  it("tells a lapsed trial apart from a running one", async () => {
    await signedUpDaysAgo(30);

    const { trial } = (await (await get("/v1/me")).json()) as { trial: Trial };

    // The distinction the sidebar could not make: both of these are `plan:
    // "free"`, and one of them was being offered a fortnight it had already had.
    expect(trial.status).toBe("expired");
    expect(trial.daysLeft).toBe(0);
  });

  it("says paid on a paying team, however old the account", async () => {
    await signedUpDaysAgo(400);
    await env.DB.exec("UPDATE organization SET plan = 'pro' WHERE id = 'org1'");

    const me = (await (await get("/v1/me")).json()) as { trial: Trial };
    const billing = (await (await get("/v1/billing")).json()) as { trial: Trial };

    expect(me.trial.status).toBe("paid");
    // Both payloads, because the sidebar reads one and the billing panel reads
    // the other, and a disagreement between them is an upgrade card beside a
    // page that says the team is already paying.
    expect(billing.trial.status).toBe("paid");
  });

  it("answers the same verdict on /v1/billing as on /v1/me", async () => {
    await signedUpDaysAgo(13);

    const me = (await (await get("/v1/me")).json()) as { trial: Trial };
    const billing = (await (await get("/v1/billing")).json()) as { trial: Trial };

    expect(billing.trial).toEqual(me.trial);
    expect(billing.trial.daysLeft).toBe(1);
  });
});
