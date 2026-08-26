"use client";

import { useEffect, useState } from "react";

import { formatBytes } from "@/lib/format";
import { Button } from "@/components/Button";
import { api, ApiError } from "@/lib/api";
import { PRICE_MONTHLY } from "@/lib/pricing";

import { UpgradeDialog } from "./UpgradeDialog";

interface Billing {
  plan: "free" | "pro";
  storageQuotaBytes: number;
  /** Seats in use and seats paid for, both excluding the one the plan includes. */
  seatsUsed: number;
  seatsPurchased: number;
  /** What the seat count drops to at renewal, or null when nothing is pending. */
  scheduledSeats: number | null;
  status: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/**
 * The plan, the seats, and the two buttons that change either.
 *
 * A client component because both actions end in a redirect to a URL only the
 * API can mint — a checkout session and a portal session are both single-use
 * and time-limited, so neither can be rendered into the page ahead of the click.
 */
export function BillingPanel({ canManage }: { canManage: boolean }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    api<Billing>("/v1/billing")
      .then(setBilling)
      .catch(() => setError("Couldn't load your plan."));
  }, []);

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

  if (!billing) {
    return <p className="mt-8 text-sm text-muted">{error ?? "Loading…"}</p>;
  }

  const pro = billing.plan === "pro";
  // Seats include the one the product comes with, which is what the team
  // actually counts in heads. The API talks in add-on seats; this does not.
  const seatsUsed = billing.seatsUsed + 1;
  const seatsHeld = billing.seatsPurchased + 1;
  const idle = seatsHeld - seatsUsed;

  return (
    <>
      <UpgradeDialog open={upgrading} canManage={canManage} onClose={() => setUpgrading(false)} />

      <div className="lit mt-8 rounded-2xl border border-line bg-elevated p-6">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">Current plan</p>
        <p className="mt-2 text-lg text-fg capitalize">{billing.plan}</p>

        {pro ? (
          <>
            <p className="mt-1 text-sm text-muted">
              {seatsUsed} of {seatsHeld} {seatsHeld === 1 ? "seat" : "seats"} in use,{" "}
              {formatBytes(billing.storageQuotaBytes)} of shared recordings.
            </p>

            {/* A team that shrank. Worth saying out loud, because the seat is
                still being paid for and the money is not coming back — what it
                is, is available to fill for free until the renewal. */}
            {idle > 0 ? (
              <p className="mt-3 text-sm text-muted">
                {idle === 1 ? "One seat is" : `${idle} seats are`} free to fill at no extra cost.
                {billing.scheduledSeats !== null && billing.currentPeriodEnd
                  ? ` Unfilled, ${idle === 1 ? "it drops" : "they drop"} off your bill on ${DATE.format(new Date(billing.currentPeriodEnd))}.`
                  : null}
              </p>
            ) : null}

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
          <p className="mt-1 text-sm text-muted">
            One person, {formatBytes(billing.storageQuotaBytes)} of recordings, and no teammates.
            Prequel is {PRICE_MONTHLY} per seat per month.
          </p>
        )}

        {error ? (
          <p className="mt-4 text-sm text-brand-from" role="alert">
            {error}
          </p>
        ) : null}

        {canManage ? (
          <div className="mt-6">
            {pro ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={portal}
              >
                {pending ? "Opening…" : "Manage billing"}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setUpgrading(true)}>
                Upgrade to Pro
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">Only an owner or admin can change the plan.</p>
        )}
      </div>
    </>
  );
}
