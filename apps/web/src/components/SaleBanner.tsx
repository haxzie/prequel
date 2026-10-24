import Link from "next/link";

import { PRICE_LIFETIME, PRICE_LIFETIME_WAS } from "@/lib/pricing";

import { SparkIcon } from "./icons";

// The accessible name, built from the prices rather than typed beside them.
// The strip used to carry its own copy of both numbers, which is how it went
// on advertising a sale price the pricing page had already moved past. The
// visible copy below strikes the old price; `<s>` is announced as "deleted" by
// some screen readers and as nothing by others, so the label says it in words
// instead.
const COPY = `Launch day sale, was ${PRICE_LIFETIME_WAS}, only ${PRICE_LIFETIME} now`;

// Enough repeats that one copy alone is wider than any viewport the site is
// read on. The track is two copies and slides one copy's width per loop, so if
// a copy were narrower than the screen the restart would land on a gap.
const REPEATS = 8;

/**
 * The launch-day strip above the nav on every marketing page: the line
 * repeated along a ticker, a star between each repeat, sliding left.
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
 * The sun gradient, because this is the only chrome on the site allowed to be
 * loud and it should read as the product's own colour rather than a third-party
 * promo bar. Mounted in the marketing layout only — the dashboard and the sign-in
 * page have nothing to sell.
 *
 * Nothing at all when there is no sale on, which is the state today. The gate
 * is here rather than in the layout so that ending a sale is one constant in
 * `lib/pricing.ts` and not a constant plus an unmounting: a strip that keeps
 * announcing a price the cards no longer charge is worse than no strip.
 */
export function SaleBanner() {
  if (!PRICE_LIFETIME_WAS) return null;

  return (
    <Link
      href="/pricing"
      aria-label={`${COPY}. See pricing`}
      className="block overflow-hidden bg-gradient-to-r from-brand-from to-brand-to text-white transition-opacity hover:opacity-90"
    >
      <div
        data-marquee
        className="flex w-max animate-marquee items-center py-2 text-sm font-medium whitespace-nowrap"
      >
        <Run />
        <Run hidden />
      </div>
    </Link>
  );
}

function Run({ hidden = false }: { hidden?: boolean }) {
  return (
    <span className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {Array.from({ length: REPEATS }, (_, i) => (
        <span key={i} className="flex items-center">
          <span className="px-6">
            Launch day sale{" "}
            {/* Struck in a lighter ink so the eye lands on the live price and
                not on the one that is gone. The strike is on the old price
                alone: striking the dollar sign and the gap around it too reads
                as a line through the sentence. */}
            <s className="text-white/70">{PRICE_LIFETIME_WAS}</s> only{" "}
            <strong className="font-semibold">{PRICE_LIFETIME}</strong> now
          </span>
          <SparkIcon className="size-3 shrink-0" />
        </span>
      ))}
    </span>
  );
}
