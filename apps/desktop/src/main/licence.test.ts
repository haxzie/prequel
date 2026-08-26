/**
 * The trial's edges.
 *
 * Every one of these is a boundary nobody exercises by hand: the last hour of
 * the fourteenth day, the hour after it, and a paid account whose trial ended
 * months ago. Getting any of them wrong produces an app that works perfectly in
 * every manual test and locks somebody out — or lets everybody in — on a date
 * nobody thought to set the clock to.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  shell: { openExternal: () => undefined },
}));

const { statusOf } = await import("./licence.js");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 26, 12, 0, 0);

describe("statusOf", () => {
  it("is a trial while the fourteen days are running", () => {
    expect(statusOf({ plan: "free", trialEndsAt: NOW + 6 * DAY }, NOW)).toEqual({
      status: "trial",
      daysLeft: 6,
    });
  });

  it("rounds a part-day up, so the last day is never reported as none left", () => {
    // Ten minutes left is still a day the user can export in. Reporting zero
    // here reads as "it has ended" beside an app that still works.
    expect(statusOf({ plan: "free", trialEndsAt: NOW + 10 * 60 * 1000 }, NOW)).toEqual({
      status: "trial",
      daysLeft: 1,
    });
  });

  it("expires on the instant, not the day after", () => {
    expect(statusOf({ plan: "free", trialEndsAt: NOW }, NOW).status).toBe("expired");
    expect(statusOf({ plan: "free", trialEndsAt: NOW - 1 }, NOW).status).toBe("expired");
    expect(statusOf({ plan: "free", trialEndsAt: NOW + 1 }, NOW).status).toBe("trial");
  });

  it("ignores the trial entirely once the team is paying", () => {
    // The one that matters most: a subscriber whose trial ran out long ago must
    // never see the upgrade dialog, and `trialEndsAt` keeps moving into the
    // past for the whole life of the account.
    expect(statusOf({ plan: "pro", trialEndsAt: NOW - 400 * DAY }, NOW)).toEqual({
      status: "paid",
    });
  });
});
