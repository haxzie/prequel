import { formatBytes } from "@/app/app/page";
import { PLANS, PRICE_YEARLY } from "@/lib/pricing";
import { pageMetadata } from "@/lib/seo";
import { requireTeam } from "@/lib/session";

export const metadata = pageMetadata({
  title: "Billing",
  description: "Your plan and storage.",
  path: "/app/settings/billing",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

/**
 * The plan, before there is anything to buy.
 *
 * A placeholder that is still honest about the model rather than a "coming
 * soon" card: the quota is real, it is what an upload is checked against, and a
 * team that hits it needs to see the number it hit. Prices come from
 * `lib/pricing.ts` so this page and the public pricing page cannot disagree.
 */
export default async function BillingPage() {
  const { team } = await requireTeam();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-medium tracking-tight text-fg">Billing</h1>
      <p className="mt-1.5 text-sm text-muted">
        Your plan and invoices live here. Prequel is {PRICE_YEARLY} per user per year at
        introductory pricing, which goes up later.
      </p>

      <div className="lit mt-8 rounded-2xl border border-line bg-elevated p-6">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">Current plan</p>
        <p className="mt-2 text-lg text-fg capitalize">{team.plan}</p>
        <p className="mt-1 text-sm text-muted">
          Up to {formatBytes(team.storageQuotaBytes)} of shared recordings.
        </p>
      </div>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <li key={plan.name} className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-sm font-medium text-fg">{plan.name}</p>
            <p className="mt-1 text-2xl text-fg">
              {plan.price} <span className="text-sm text-muted">{plan.cadence}</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{plan.summary}</p>
            <button
              type="button"
              disabled
              className="mt-4 w-full rounded-full border border-line px-4 py-2 text-sm text-muted disabled:cursor-not-allowed"
            >
              Coming soon
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
