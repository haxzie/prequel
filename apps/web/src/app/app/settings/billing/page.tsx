import { BillingPanel } from "@/components/dashboard/BillingPanel";
import { PRICE_MONTHLY } from "@/lib/pricing";
import { pageMetadata } from "@/lib/seo";
import { requireTeam } from "@/lib/session";

export const metadata = pageMetadata({
  title: "Billing",
  description: "Your plan and seats.",
  path: "/app/settings/billing",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

/** Only these two may spend money. The API enforces it; this only hides it. */
const CAN_MANAGE = new Set(["owner", "admin"]);

/**
 * The plan, and what it costs to grow the team.
 *
 * The panel below is a client component because subscription state lives behind
 * `GET /v1/billing` rather than on the session — the team row this page already
 * has says `pro` or `free` and nothing about seats, and seats are the number
 * somebody comes to this page to look at.
 */
export default async function BillingPage() {
  const { team } = await requireTeam();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-medium tracking-tight text-fg">Billing</h1>
      <p className="mt-1.5 text-sm text-muted">
        Prequel is {PRICE_MONTHLY} per seat per month at introductory pricing, which goes up later.
        Your subscription includes one seat; each teammate takes another.
      </p>

      <BillingPanel canManage={CAN_MANAGE.has(team.role)} />

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">
          How seats work
        </p>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
          <li>
            A teammate joining takes a seat. If every seat is taken, one is added and charged for
            the rest of your month.
          </li>
          <li>
            Removing someone frees their seat but keeps it. Filling it again costs nothing, and if
            it is still empty at your renewal it drops off the bill then.
          </li>
        </ul>
      </div>
    </div>
  );
}
