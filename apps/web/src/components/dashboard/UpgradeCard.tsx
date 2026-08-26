import Link from "next/link";

import { PLANS, TRIAL_DAYS } from "@/lib/pricing";
import type { Trial } from "@/lib/session";

/**
 * The one place the sidebar asks for money.
 *
 * Shown only while the team is not paying, so it disappears the moment it stops
 * being true rather than sitting there as furniture.
 *
 * **It says which of the three states the account is in.** This card used to
 * offer "Try 14 days free" to everybody on the free plan, which is the same
 * label to somebody on day three of their trial, somebody whose trial ran out in
 * March, and somebody who signed up an hour ago. The first two are worse than
 * useless: one is being sold something they already have, and the other is being
 * offered a second fortnight that does not exist. The plan alone cannot tell
 * them apart — `plan` stays `free` right through a trial — which is why the
 * verdict comes from the API.
 *
 * It does not name the plan. There is exactly one paid licence and it is called
 * "Prequel" — see `lib/pricing.ts` — so a card headed with that name inside the
 * Prequel dashboard reads as a link to the homepage rather than as an offer.
 *
 * It links to the billing page rather than straight to a checkout: checkout is
 * owner-and-admin only, and a card that opens a payment page for somebody who is
 * not allowed to pay is a dead end. The billing page can say so.
 */
export function UpgradeCard({ trial, className = "" }: { trial: Trial; className?: string }) {
  const copy = COPY[trial.status === "trial" ? "trial" : "expired"];
  // The price and its cadence both come from `lib/pricing.ts`, which is the only
  // file allowed to carry either. Writing "per user, per month" out here would
  // be a second cadence to keep in step with a plan that has one.
  const licence = PLANS[0];

  return (
    <Link
      href="/app/settings/billing"
      className={`lit block rounded-xl border border-line bg-surface p-3.5 transition-colors hover:border-muted/40 ${className}`}
    >
      {/* The brand gradient, and the only place it appears in the dashboard —
          which is what makes it read as an offer rather than as another row. */}
      <span className="brand-gradient bg-clip-text text-xs font-semibold text-transparent">
        {copy.heading(trial)}
      </span>

      <p className="mt-1.5 text-xs leading-relaxed text-muted">{copy.body}</p>

      {licence ? (
        <p className="mt-2 text-xs text-fg">
          {licence.price} <span className="text-muted">{licence.cadence}</span>
        </p>
      ) : null}

      <span className="mt-3 flex items-center gap-1 text-xs font-medium text-fg">
        {copy.action}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3"
          aria-hidden="true"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </span>
    </Link>
  );
}

/**
 * Two states, and neither of them promises a trial.
 *
 * A running trial is counted down rather than sold: the whole app is already
 * unlocked, and the useful thing to say is how long that lasts. What ends is
 * exporting — recordings, edits and every file already written stay — so the
 * body says that and nothing broader. Claiming the library or the links stop
 * working would be untrue and checkable in one click.
 */
const COPY = {
  trial: {
    heading: (trial: Trial) =>
      trial.daysLeft === 1 ? "1 day left" : `${trial.daysLeft} days left`,
    body: "Your trial has the whole app in it. Exporting stops when it runs out.",
    action: "See the plan",
  },
  expired: {
    // Not "0 days left". The countdown is over and the state changed, and a
    // number that has run to zero reads as a countdown that is still running.
    heading: () => "Trial ended",
    body: `Your ${TRIAL_DAYS} days are up and the app has stopped exporting. Everything you already exported is yours.`,
    action: "Upgrade",
  },
} as const;
