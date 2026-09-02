/**
 * The trial's edges.
 *
 * Every one of these is a boundary nobody exercises by hand: the last hour of
 * the fourteenth day, the hour after it, and a paid account whose trial ended
 * months ago. Getting any of them wrong produces an app that works perfectly in
 * every manual test and locks somebody out — or lets everybody in — on a date
 * nobody thought to set the clock to.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  shell: { openExternal: () => undefined },
}));

const api = await vi.importActual<typeof import("./api.js")>("./api.js");

const apiFetch = vi.fn();
vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const forgetRejectedSignIn = vi.fn();
vi.mock("./auth.js", () => ({
  authToken: () => "a-token",
  forgetRejectedSignIn: () => forgetRejectedSignIn(),
}));

const { statusOf, refreshEntitlement } = await import("./licence.js");

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

  it("treats the lifetime licence as paid, the same as a subscription", () => {
    // The Worker currently answers `pro` for it — see `Facts.plan` — so this
    // pins the behaviour that lets that mapping be dropped rather than a
    // behaviour anything relies on today.
    expect(statusOf({ plan: "lifetime", trialEndsAt: NOW - 400 * DAY }, NOW)).toEqual({
      status: "paid",
    });
  });
});

/**
 * What a refused token does to the sign-in it came from.
 *
 * The state this exists to prevent: the app says it is signed in, the account
 * shows in the sidebar, and every authenticated call disagrees. It reached a
 * real machine — a stored token the server had stopped accepting — and the only
 * trace was one warning in a log, because the entitlement check is the only
 * authenticated call that runs without being asked for.
 */
describe("a sign-in the server refuses", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    forgetRejectedSignIn.mockReset();
  });

  it("is dropped, so the app stops claiming to be signed in", async () => {
    apiFetch.mockRejectedValue(new api.ApiError("unauthorized", "Sign in to continue.", 401));

    await refreshEntitlement();

    expect(forgetRejectedSignIn).toHaveBeenCalled();
  });

  it("is kept when the server merely could not be reached", async () => {
    // The distinction that matters. A refusal is the server saying this token
    // is nobody; a network failure says nothing about it at all, and signing
    // somebody out for being on a train would be the worse bug of the two.
    apiFetch.mockRejectedValue(new Error("offline"));

    await refreshEntitlement();

    expect(forgetRejectedSignIn).not.toHaveBeenCalled();
  });

  it("is kept when the server fails on its own account", async () => {
    apiFetch.mockRejectedValue(new api.ApiError("server_error", "Something went wrong.", 500));

    await refreshEntitlement();

    expect(forgetRejectedSignIn).not.toHaveBeenCalled();
  });
});
