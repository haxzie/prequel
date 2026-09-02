/**
 * Whether this Mac may export, and what to say when it may not.
 *
 * The app is otherwise indifferent to who is signed in: recording, editing and
 * export all run locally and none of them has ever needed an account. Export is
 * the one place that now asks, because export is what the licence is sold for.
 *
 * **The server owns the facts and this file owns the verdict.** `/v1/desktop/
 * entitlement` answers with two things — when the trial ends and whether the
 * team is paying — and the three-way status is derived here and nowhere else.
 * Splitting it the other way, with the Worker returning "expired", would put
 * the same rule on both sides of the wire for the two to disagree about.
 *
 * **The trial is anchored to the account, not to this install.** Fourteen days
 * from the sign-up date, which lives in a row the app cannot write. A local
 * anchor — a timestamp in `userData`, the install id's file date — restarts the
 * trial for anyone who deletes a file, and a trial that a reinstall renews is
 * not a trial.
 *
 * What this is not is enforcement. The check runs in the app, on the app's own
 * clock, and anybody willing to edit a JSON file or wind the date back can get
 * past it. Enforcement would mean the exporter refusing to run without a fresh
 * server answer, which would also mean no exporting on a plane. This is a
 * prompt aimed at the people who would pay if asked, and it is worth being
 * clear-eyed that it is only that.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, shell } from "electron";

import type { Entitlement } from "../shared/contract.js";
import { apiFetch, ApiError, appUrl } from "./api.js";
import { authToken, forgetRejectedSignIn } from "./auth.js";
import { log } from "./log.js";

/**
 * Its own file, beside `auth.json` and `install.json` and for the same reason
 * both of those have one: `RecordingPreferences` is broadcast to every window
 * inside `DockState`, and none of this belongs in a renderer.
 *
 * Nothing in here is a secret — it is a plan name and a date the server already
 * told us — so it is written at the default mode rather than `0o600`. Treating
 * a cache like a credential invites somebody to store a credential in it.
 */
const FILE = "licence.json";

/** What the Worker answers with. Facts only; the verdict is `statusOf`. */
interface Facts {
  /**
   * The tier this account is on.
   *
   * `lifetime` is a tier the Worker holds but does not currently send — it
   * answers `pro` for it, because the builds already in the field parse two
   * values and read a third as "not paid". Accepted here so that mapping can be
   * dropped once those builds are gone, and because a value this file rejects
   * is one it silently forgets on the next launch.
   */
  plan: "free" | "pro" | "lifetime";
  /** Epoch milliseconds. Sign-up plus the trial length, decided server-side. */
  trialEndsAt: number;
}

/**
 * The last answer the server gave, and when it gave it.
 *
 * Cached so that a check can survive being offline. `trialEndsAt` is an
 * absolute instant rather than a countdown precisely so a stale cache is still
 * correct — a cached "six days left" would be wrong tomorrow, where a cached
 * end date is right until the plan changes.
 */
interface Cached extends Facts {
  checkedAt: number;
}

let cached: Cached | null | undefined;
let listeners: ((entitlement: Entitlement) => void)[] = [];

function file(): string {
  return join(app.getPath("userData"), FILE);
}

function read(): Cached | null {
  if (cached !== undefined) return cached;

  try {
    const stored = JSON.parse(readFileSync(file(), "utf8")) as Partial<Cached>;

    cached =
      (stored.plan === "free" || stored.plan === "pro" || stored.plan === "lifetime") &&
      typeof stored.trialEndsAt === "number" &&
      typeof stored.checkedAt === "number"
        ? { plan: stored.plan, trialEndsAt: stored.trialEndsAt, checkedAt: stored.checkedAt }
        : null;
  } catch {
    // No file yet, or an unreadable one. Either way nothing is known about this
    // account, and the answer is whatever the network says next.
    cached = null;
  }

  return cached;
}

function write(value: Cached | null): void {
  cached = value;

  try {
    writeFileSync(file(), JSON.stringify(value, null, 2), "utf8");
  } catch (cause) {
    // A read-only userData directory should not stop an export. The answer
    // stays in memory for this launch and is asked for again next time.
    console.warn("[licence] could not persist the entitlement:", cause);
  }
}

/**
 * The verdict, from the facts and the clock.
 *
 * Exported for its test rather than for a caller — the boundary cases are the
 * ones nobody exercises by hand, and "the last day of the trial" is exactly the
 * kind of off-by-one that ships.
 */
export function statusOf(facts: Facts, now = Date.now()): Entitlement {
  // Any tier but `free` has been paid for. Naming `pro` alone is what would put
  // a paywall in front of somebody holding the lifetime licence.
  if (facts.plan !== "free") return { status: "paid" };

  const remaining = facts.trialEndsAt - now;
  if (remaining <= 0) return { status: "expired" };

  // Rounded up, so the last partial day reads as "1 day left" rather than as
  // zero. A trial that says nothing is left while it still works is a trial
  // that gets abandoned a day early.
  return { status: "trial", daysLeft: Math.ceil(remaining / (24 * 60 * 60 * 1000)) };
}

/**
 * What is known right now, with no network call.
 *
 * Signed out is its own status rather than being folded into "expired": the two
 * want different buttons, and telling somebody their trial has run out when
 * they have never had one is simply wrong.
 */
export function entitlement(): Entitlement {
  if (!authToken()) return { status: "signed-out" };

  const facts = read();
  // Signed in, never successfully checked. Everything about this state is
  // unknown, including whether they are paying — and refusing an export on a
  // guess is the one outcome that is certainly wrong.
  if (!facts) return { status: "unknown" };

  return statusOf(facts);
}

/**
 * Asks the server, and remembers the answer.
 *
 * Called when the Export button is pressed rather than on a timer: that is the
 * one moment the answer matters, it is a moment the user is already waiting
 * through, and a background poll would be a request every few minutes for a
 * value that changes twice in a lifetime.
 *
 * A failure is not a refusal. Any of the several dozen ways a network call can
 * fail leaves the previous answer in place — offline, a captive portal, the
 * Worker being redeployed — because an export blocked by a hotel wifi is a bug
 * report, and the cost of the opposite mistake is one unpaid export.
 */
export async function refreshEntitlement(): Promise<Entitlement> {
  const token = authToken();
  if (!token) return { status: "signed-out" };

  try {
    const facts = await apiFetch<Facts>("/v1/desktop/entitlement", { token });

    const before = entitlement();
    write({ ...facts, checkedAt: Date.now() });
    const after = entitlement();

    if (after.status !== before.status) {
      log("info", `entitlement is now ${after.status}`);
      for (const listener of listeners) listener(after);
    }

    return after;
  } catch (cause) {
    // Warned rather than logged: this is worth tripping over in `pnpm dev`, and
    // in a packaged build it is the breadcrumb that explains why somebody was
    // never asked to upgrade.
    console.warn(
      "[licence] could not check the entitlement:",
      cause instanceof ApiError ? cause.message : cause,
    );

    // A refusal is not a failure to reach the server, it is the server saying
    // this token is nobody. Left alone, the app goes on claiming to be signed
    // in while nothing authenticated works — and this is the call that finds
    // out, because it is the only one that runs unprompted at launch rather
    // than waiting for somebody to press Export.
    if (cause instanceof ApiError && cause.status === 401) forgetRejectedSignIn();

    return entitlement();
  }
}

export function onEntitlementChanged(listener: (entitlement: Entitlement) => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
}

/**
 * Forgets what was known. Called when the Mac signs out.
 *
 * Without this, signing out of a paid account and into a free one would export
 * happily on the previous account's answer until the next successful check.
 */
export function clearEntitlement(): void {
  write(null);
}

/**
 * Opens the page that takes the money.
 *
 * Straight to billing rather than to the dashboard: this is reached by pressing
 * Upgrade, and landing on a library with the payment two clicks further on is
 * how an intent to pay evaporates. Signing in, if they are signed out, is the
 * web app's problem — it already redirects to the login and back.
 */
export function openUpgrade(): void {
  void shell.openExternal(new URL("/app/settings/billing", appUrl()).toString());
}
