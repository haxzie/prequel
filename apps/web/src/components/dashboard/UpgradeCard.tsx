import Link from "next/link";

import { PLANS, TRIAL_DAYS } from "@/lib/pricing";

/**
 * The one place the sidebar asks for money.
 *
 * Shown only on the free plan, so it disappears the moment it stops being true
 * rather than sitting there as furniture.
 *
 * It does not name the plan. There is exactly one paid licence and it is called
 * "Prequel" — see `lib/pricing.ts` — so a card headed with that name inside the
 * Prequel dashboard reads as a link to the homepage rather than as an offer.
 * What it leads with instead is the line the pricing page draws: recording and
 * editing are free forever, and the licence is the part that costs us money
 * every month to run.
 *
 * Nothing is for sale yet, so it goes to the plan rather than to a checkout.
 */
export function UpgradeCard({ className = "" }: { className?: string }) {
  const licence = PLANS[0];

  return (
    <Link
      href="/app/settings/billing"
      className={`lit block rounded-xl border border-line bg-surface p-3.5 transition-colors hover:border-muted/40 ${className}`}
    >
      {/* The brand gradient, and the only place it appears in the dashboard —
          which is what makes it read as an offer rather than as another row. */}
      <span className="brand-gradient bg-clip-text text-xs font-semibold text-transparent">
        Upgrade
      </span>

      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Transcripts, uploads and links your whole team can share.
      </p>

      {licence ? (
        <p className="mt-2 text-xs text-fg">
          {licence.price} <span className="text-muted">{licence.cadence}</span>
        </p>
      ) : null}

      <span className="mt-3 flex items-center gap-1 text-xs font-medium text-fg">
        {TRIAL_DAYS ? `Try ${TRIAL_DAYS} days free` : "See the plan"}
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
