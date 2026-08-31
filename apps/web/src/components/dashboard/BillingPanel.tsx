"use client";

import { useState } from "react";

import { formatBytes } from "@/lib/format";
import { Button } from "@/components/Button";
import { api, ApiError } from "@/lib/api";
import { PRICE_MONTHLY } from "@/lib/pricing";
import type { Trial } from "@/lib/session";

/** What `GET /v1/billing` answers with. The page reads it; this draws it. */
export interface Billing {
  plan: "free" | "pro";
  /** Which of the three states the account is in. `plan` alone cannot say. */
  trial: Trial;
  storageQuotaBytes: number;
  status: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/**
 * The plan, and the two buttons that change it.
 *
 * A client component because both actions end in a redirect to a URL only the
 * API can mint — a checkout session and a portal session are both single-use and
 * time-limited, so neither can be rendered into the page ahead of the click.
 *
 * The *reading* half is not client work, and used to be. Fetching `/v1/billing`
 * from an effect put a third leg on the waterfall — render the page, hydrate,
 * then go and ask — so the only thing this page had to say sat behind "Loading…"
 * for a round-trip that started after the page had already finished loading. The
 * page now fetches it alongside the session and hands it down.
 */
export function BillingPanel({
  billing,
  canManage,
}: {
  /** Null when the Worker could not be reached; the panel says so. */
  billing: Billing | null;
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Straight to Dodo, with nothing in between.
   *
   * There used to be a confirmation modal in front of this, for the flow where
   * an upgrade was the answer to something the user had just been refused. That
   * flow was inviting a teammate, and it is gone. Anybody reaching this button
   * is already on the billing page reading the price — a modal repeating the
   * page behind it is a click that buys nothing.
   *
   * Left pending on success. The redirect is in flight, and a button that comes
   * back to life invites a second checkout session.
   */
  const checkout = async () => {
    setPending(true);
    setError(null);

    try {
      const { url } = await api<{ url: string }>("/v1/billing/checkout", { method: "POST" });
      // A full navigation rather than a router push: the destination is Dodo's
      // host, and Next's router only knows about routes in this app.
      window.location.href = url;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Couldn't start checkout.");
      setPending(false);
    }
  };

  const portal = async () => {
    setPending(true);
    setError(null);

    try {
      const { url } = await api<{ url: string }>("/v1/billing/portal", { method: "POST" });
      window.location.href = url;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Couldn't open billing.");
      setPending(false);
    }
  };

  // No "Loading…" branch any more: by the time this renders the data is either
  // here or it is not coming, and the skeleton in `loading.tsx` covers the wait.
  if (!billing) {
    return (
      <p className="mt-8 text-sm text-muted" role="alert">
        Couldn&rsquo;t load your plan.
      </p>
    );
  }

  const pro = billing.plan === "pro";
  const trial = billing.trial;

  return (
    <div className="lit mt-8 rounded-2xl border border-line bg-elevated p-6">
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">Current plan</p>
      {/* Never the raw `plan`. It reads `free` for a fortnight that has every
          feature in it and again for one that ran out in March, and a heading
          that cannot tell those apart is the whole reason somebody opens this
          page. */}
      <p className="mt-2 text-lg text-fg">
        {pro ? "Pro" : trial.status === "trial" ? "Trial" : "Trial ended"}
      </p>

      {pro ? (
        <>
          <p className="mt-1 text-sm text-muted">
            {formatBytes(billing.storageQuotaBytes)} of shared recordings.
          </p>

          {billing.graceUntil ? (
            <p className="mt-3 text-sm text-brand-from">
              Your last payment didn&apos;t go through. Update your card by{" "}
              {DATE.format(new Date(billing.graceUntil))} to stay on Pro.
            </p>
          ) : billing.currentPeriodEnd ? (
            <p className="mt-3 text-sm text-muted">
              Renews on {DATE.format(new Date(billing.currentPeriodEnd))}.
            </p>
          ) : null}
        </>
      ) : (
        <>
          {/* What is running out, and when. The date is the useful half — a
              bare count of days is a number somebody has to convert into a
              weekday before they can act on it. */}
          <p className="mt-1 text-sm text-fg">
            {trial.status === "trial"
              ? `${trial.daysLeft === 1 ? "1 day" : `${trial.daysLeft} days`} left, ending on ${DATE.format(new Date(trial.endsAt))}.`
              : `Ended on ${DATE.format(new Date(trial.endsAt))}. The app has stopped exporting.`}
          </p>

          {/* True in both states, and deliberately not folded into the line
              above: the storage is what a licence adds, where the trial is
              about the app. */}
          <p className="mt-1 text-sm text-muted">
            {formatBytes(billing.storageQuotaBytes)} of recordings. Prequel is {PRICE_MONTHLY} per
            month.
          </p>
        </>
      )}

      {error ? (
        <p className="mt-4 text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}

      {canManage ? (
        <div className="mt-6">
          {pro ? (
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={portal}>
              {pending ? "Opening…" : "Manage billing"}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={pending} onClick={checkout}>
              {pending ? "Opening checkout…" : "Upgrade to Pro"}
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted">Only an owner or admin can change the plan.</p>
      )}
    </div>
  );
}
