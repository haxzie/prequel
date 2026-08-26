/**
 * How long a new account may use Prequel before paying, and what that means
 * today.
 *
 * The length is decided here rather than by either client — a number the app or
 * the site could edit is not a trial length, it is a default. Fourteen days from
 * `user.createdAt`, a row neither of them can write, so a reinstall or a cleared
 * browser buys nobody another fortnight.
 *
 * **The two clients are served differently, on purpose.**
 *
 * `/v1/desktop/entitlement` returns facts — a plan and an end date — and
 * `main/licence.ts` derives the verdict from them. It has to: that answer is
 * cached to disk and read again on a plane, against the Mac's own clock, hours
 * or days after the Worker last spoke. A verdict computed here would be stale
 * by then, and a cached "six days left" is wrong tomorrow where a cached end
 * date is right until the plan changes.
 *
 * The dashboard is the opposite case. It is server-rendered per request by a
 * runtime that already knows the time and never caches the answer, so it is
 * handed the verdict from `trialStatus` below. The alternative — `apps/web`
 * reimplementing the rounding rule — would put it in the one package in this
 * repo with no test runner, and "1 day left" against an app that still exports
 * is exactly the off-by-one nobody exercises by hand.
 */

export const TRIAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch milliseconds, because `Date` takes milliseconds on both sides. */
export function trialEndsAt(signedUpAt: Date): number {
  return signedUpAt.getTime() + TRIAL_DAYS * DAY_MS;
}

export interface Trial {
  status: "paid" | "trial" | "expired";
  /** Whole days remaining, rounded up. Zero when paid, and zero once it has run out. */
  daysLeft: number;
  /** Epoch milliseconds. Answered whatever the status, so a page can say when it ended. */
  endsAt: number;
}

/**
 * The verdict, from the plan and the clock.
 *
 * `endsAt` is carried through even for a paying team. It keeps moving into the
 * past for the whole life of an account and nothing should read it as a date to
 * act on — but the billing page wants to say "ended on the 9th" to somebody
 * deciding whether to pay, and re-deriving it there from a sign-up date would be
 * the second implementation this file exists to prevent.
 */
export function trialStatus(plan: "free" | "pro", endsAt: number, now = Date.now()): Trial {
  if (plan === "pro") return { status: "paid", daysLeft: 0, endsAt };

  const remaining = endsAt - now;
  if (remaining <= 0) return { status: "expired", daysLeft: 0, endsAt };

  // Rounded up, so the last partial day reads as "1 day left" rather than as
  // none. A trial that says nothing is left while the app still exports is a
  // trial that gets abandoned a day early. `main/licence.ts` rounds the same
  // way, and the two are only ever compared by a user holding both.
  return { status: "trial", daysLeft: Math.ceil(remaining / DAY_MS), endsAt };
}
