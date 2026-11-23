import Link from "next/link";

import { SALE } from "@/lib/pricing";

import { SparkIcon } from "./icons";

// Enough repeats that one copy alone is wider than any viewport the site is
// read on. The track is two copies and slides one copy's width per loop, so if
// a copy were narrower than the screen the restart would land on a gap.
const REPEATS = 8;

/**
 * The sale strip above the nav on every marketing page: the line repeated along
 * a ticker, a star between each repeat, sliding left.
 *
 * The whole strip is one link to pricing rather than a button beside the copy.
 * The text is in motion, so a target that moves with it is a target people
 * miss; the strip itself is the thing to click.
 *
 * The second copy of the run is `aria-hidden`: a screen reader would otherwise
 * read sixteen identical sentences, and the first copy already says it eight
 * times more than it needs to. The link's `aria-label` carries the sentence
 * once so the accessible name is the words and not the stars.
 *
 * The code is in the sentence rather than behind a copy button. A button in a
 * strip that is sliding is a target that moves, and the word is six letters
 * somebody retypes at checkout faster than they chase it.
 *
 * The sun gradient, because this is the only chrome on the site allowed to be
 * loud and it should read as the product's own colour rather than a third-party
 * promo bar. Mounted in the marketing layout only — the dashboard and the
 * sign-in page have nothing to sell.
 *
 * Nothing at all when there is no sale on, which is the usual state. The gate
 * is here rather than in the layout so that ending a sale is one constant in
 * `lib/pricing.ts` and not a constant plus an unmounting: a strip that keeps
 * offering a code checkout no longer takes is worse than no strip.
 */
export function SaleBanner() {
  const sale = SALE;
  if (!sale) return null;

  return (
    <Link
      href="/pricing"
      aria-label={`${sale.headline}: ${sale.offer} with the code ${sale.code}. See pricing`}
      className="block overflow-hidden bg-gradient-to-r from-brand-from to-brand-to text-white transition-opacity hover:opacity-90"
    >
      <div
        data-marquee
        className="flex w-max animate-marquee items-center py-2 text-sm font-medium whitespace-nowrap"
      >
        <Run sale={sale} />
        <Run sale={sale} hidden />
      </div>
    </Link>
  );
}

function Run({ sale, hidden = false }: { sale: NonNullable<typeof SALE>; hidden?: boolean }) {
  return (
    <span className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {Array.from({ length: REPEATS }, (_, i) => (
        <span key={i} className="flex items-center">
          <span className="px-6">
            {sale.headline} · {sale.offer} with code{" "}
            {/* The code is the one thing to carry away from the strip, so it is
                the one thing set apart from the sentence. Letter spacing rather
                than a boxed pill: a pill reads as a button and invites a click
                that would do the same thing as clicking anywhere else. */}
            <strong className="font-semibold tracking-wider">{sale.code}</strong>
          </span>
          <SparkIcon className="size-3 shrink-0" />
        </span>
      ))}
    </span>
  );
}
