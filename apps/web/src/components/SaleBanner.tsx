import Link from "next/link";

import { SparkIcon } from "./icons";

// The accessible name and the one place the words live. The visible copy
// below strikes the old price; `<s>` is announced as "deleted" by some screen
// readers and as nothing by others, so the label says it in words instead.
const COPY = "Launch day sale, was $36, only $29 now";

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
 */
export function SaleBanner() {
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
            <s className="text-white/70">$36</s> only <strong className="font-semibold">$29</strong>{" "}
            now
          </span>
          <SparkIcon className="size-3 shrink-0" />
        </span>
      ))}
    </span>
  );
}
