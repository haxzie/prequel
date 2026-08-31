import { cookies } from "next/headers";

import { BillingPanel, type Billing } from "@/components/dashboard/BillingPanel";
import { API_URL } from "@/lib/api";
import { PRICE_MONTHLY } from "@/lib/pricing";
import { pageMetadata } from "@/lib/seo";
import { requireTeam } from "@/lib/session";

export const metadata = pageMetadata({
  title: "Billing",
  description: "Your plan.",
  path: "/app/settings/billing",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

/** Only these two may spend money. The API enforces it; this only hides it. */
const CAN_MANAGE = new Set(["owner", "admin"]);

/**
 * The plan, and what it costs.
 *
 * Subscription state lives behind `GET /v1/billing` rather than on the session —
 * the team row this page already has says `pro` or `free` and nothing about the
 * renewal date, the grace window or a cancellation, which is what somebody
 * opens this page to see. So it is read here and handed down. The panel stays a
 * client component for the two buttons: checkout and the portal both end in a
 * redirect to a single-use, time-limited URL only the API can mint, so neither
 * can be rendered ahead of the click.
 */
export default async function BillingPage() {
  // Together, not one then the other. The subscription read needs nothing from
  // the session — the Worker resolves the team off the same cookie — and running
  // it here rather than from an effect in the panel takes a whole leg off the
  // waterfall this page used to have.
  const [{ team }, billing] = await Promise.all([requireTeam(), fetchBilling()]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-medium tracking-tight text-fg">Billing</h1>
      <p className="mt-1.5 text-sm text-muted">
        Prequel is {PRICE_MONTHLY} per month at introductory pricing, which goes up later.
      </p>

      <BillingPanel billing={billing} canManage={CAN_MANAGE.has(team.role)} />
    </div>
  );
}

/**
 * The team's subscription, or null.
 *
 * Null rather than a thrown error, on the same reasoning as the library's
 * listing: the rest of this page — the price, the nav around it — is still
 * worth showing, and a 500 would hide all of it behind a Worker that is briefly
 * unreachable.
 */
async function fetchBilling(): Promise<Billing | null> {
  const cookie = (await cookies()).toString();

  const response = await fetch(`${API_URL}/v1/billing`, {
    headers: { cookie },
    // Never a shared cache. This is one team's money.
    cache: "no-store",
  }).catch(() => null);

  return response?.ok ? ((await response.json()) as Billing) : null;
}
