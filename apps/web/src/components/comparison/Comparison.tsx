import { existsSync } from "node:fs";
import { join } from "node:path";

import { Logo } from "@/components/Logo";
import { Container } from "@/components/Section";
import { Cell } from "@/components/Table";
import { DownloadCta } from "@/components/DownloadButton";
import {
  FEATURE_ROWS,
  PREQUEL_FEATURES,
  formatVerified,
  type Competitor,
} from "@/content/competitors";
import { PLANS, TRIAL_DAYS } from "@/lib/pricing";
import { SITE } from "@/lib/site";

/** Where a competitor's logo goes, if we have one. See `public/logos/README.md`. */
const LOGO_DIR = join(process.cwd(), "public", "logos");

/**
 * Whether this competitor renders as their own logo or as a monogram tile.
 *
 * Two questions, deliberately separate. `logoAllowed` is whether we want to
 * show a vendor's mark — a judgement about their trademark, made in
 * `competitors.ts` — and the filesystem answers whether we actually have one.
 * The flag is checked first, so pulling a mark is one boolean rather than a
 * deletion, and a file left behind cannot quietly put it back.
 *
 * Read at build time rather than declared in `competitors.ts`. These pages are
 * all statically generated, so the check costs nothing at request time, and it
 * removes the failure this used to have — a `mark: "asset"` entry with no file
 * behind it rendered a broken image, and one field had to be kept in step with
 * a directory by hand. Now adding a logo is one file and removing it is one
 * file.
 */
function logoFor(competitor: Competitor): string | null {
  if (!competitor.logoAllowed) return null;

  // SVG first, then PNG. Most of these marks only exist as raster — an app icon
  // is drawn as one — and refusing PNG would mean nine of the eleven pages
  // falling back to a monogram over a file format.
  for (const ext of ["svg", "png"]) {
    if (existsSync(join(LOGO_DIR, `${competitor.slug}.${ext}`))) {
      return `/logos/${competitor.slug}.${ext}`;
    }
  }

  return null;
}

/**
 * The size both marks are drawn at, and the corner radius they share.
 *
 * `squircle` only sets `corner-shape` — the radius has to come with it, which
 * is why `Logo` passes one. Without it the tile renders as a hard square next
 * to a rounded logo. The fraction is the one `ComparisonHero` already passes to
 * `Logo`, so their mark and ours are the same size and the same curve.
 */
const MARK_SIZE = 64;
const MARK_RADIUS = 0.42;

/**
 * The competitor's mark: their logo where we have one, their monogram where we
 * do not.
 *
 * Both render at the size and curve above, so a page with a logo and a page
 * without are the same page rather than two different designs.
 */
function Mark({ competitor }: { competitor: Competitor }) {
  const logo = logoFor(competitor);
  const shape = { borderRadius: MARK_SIZE * MARK_RADIUS };

  if (logo) {
    return (
      <span
        className="squircle relative block size-16 overflow-hidden bg-surface ring-1 ring-white/10"
        style={shape}
      >
        {/* A plain `img`: `next/image` refuses SVG unless `dangerouslyAllowSVG`
            is set, and turning that on for files we did not draw is not a trade
            worth making for eleven icons.

            Filling the tile and clipped by it, rather than inset. Most of
            these arrive as an `apple-touch-icon.png` flattened onto opaque
            white, and a white square floating inside a rounded tile reads as a
            postage stamp rather than a logo. Filling means the squircle rounds
            their background the way it rounds ours, so their mark and ours are
            the same object at the same weight — inset, theirs reads as half the
            size of ours standing beside it, which is a thumb on the scale.

            The surface underneath still matters for the marks that arrive on
            transparency: this site is dark only, so a near-black one dropped
            straight onto the page would disappear. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          alt={`${competitor.name} logo`}
          width={MARK_SIZE}
          height={MARK_SIZE}
          className="size-full object-cover"
        />
      </span>
    );
  }

  return (
    <div
      className="squircle flex size-16 items-center justify-center border text-xl font-medium tracking-tight"
      style={{
        ...shape,
        // Their accent, tinted rather than poured in flat. A fully saturated
        // brand colour next to our own mark reads as their page rather than a
        // comparison, and eleven of them at full strength is a swatch book.
        backgroundColor: `color-mix(in oklab, ${competitor.accent} 18%, var(--surface))`,
        borderColor: `color-mix(in oklab, ${competitor.accent} 34%, transparent)`,
        color: `color-mix(in oklab, ${competitor.accent} 72%, var(--fg))`,
      }}
      aria-hidden
    >
      {competitor.monogram}
    </div>
  );
}

export function ComparisonHero({ competitor }: { competitor: Competitor }) {
  return (
    <section className="pt-20 pb-14 sm:pt-24">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-8 flex items-center justify-center gap-5">
            <Mark competitor={competitor} />
            <span className="font-mono text-xs tracking-widest text-muted uppercase">vs</span>
            <Logo size={MARK_SIZE} radius={MARK_RADIUS} />
          </div>

          <h1 className="text-[2rem] leading-[1.05] font-normal tracking-tight text-balance text-fg sm:text-5xl">
            {competitor.heading}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted">
            {competitor.lede}
          </p>

          <DownloadCta className="mt-9" />
        </div>
      </Container>
    </section>
  );
}

/** Both products side by side, before any argument is made. */
export function AtAGlance({ competitor }: { competitor: Competitor }) {
  const cards = [
    {
      name: competitor.name,
      tagline: competitor.tagline,
      // `priceSummary`, not `plans[0]` — see the note on the field. The first
      // plan alone hides a cheaper billing period and overstates the cost.
      price: competitor.priceSummary,
      free: competitor.freeTier === false ? "No free tier" : competitor.freeTier,
      platforms: competitor.features.platforms,
    },
    {
      name: SITE.name,
      tagline: SITE.tagline,
      // Built from `lib/pricing.ts` rather than written here, so a change of
      // price is one edit for all of these pages. The cadence we actually bill
      // and nothing beside it: an annualised figure next to a rival who bills
      // yearly would be a number nobody is charged.
      price: `${PLANS[0]?.price} ${PLANS[0]?.cadence}`,
      free: `${TRIAL_DAYS}-day trial, then paid`,
      platforms: PREQUEL_FEATURES.platforms,
    },
  ];

  return (
    <section className="pb-16">
      <Container>
        <div className="mx-auto grid max-w-4xl gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.name} className="bg-surface p-7">
              <h2 className="text-base font-medium text-fg">{card.name}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{card.tagline}</p>
              <dl className="mt-5 flex flex-col gap-3 text-sm">
                <div>
                  <dt className="font-mono text-[11px] tracking-wider text-muted uppercase">
                    Price
                  </dt>
                  <dd className="mt-1 text-fg">{card.price}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[11px] tracking-wider text-muted uppercase">
                    Free
                  </dt>
                  <dd className="mt-1 text-fg">{card.free}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[11px] tracking-wider text-muted uppercase">
                    Platforms
                  </dt>
                  <dd className="mt-1 text-fg">{String(card.platforms)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <Sourced competitor={competitor} className="mx-auto mt-4 max-w-4xl" />
      </Container>
    </section>
  );
}

/**
 * When the claims above were checked, and against what.
 *
 * Rendered rather than kept in a comment: a comparison that shows its working
 * is both easier to believe and easier to re-verify in six months, and third
 * party pricing goes stale without warning.
 */
function Sourced({ competitor, className = "" }: { competitor: Competitor; className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      Checked on {formatVerified(competitor.verifiedOn)} against{" "}
      {competitor.sources.map((source, i) => (
        <span key={source.url}>
          {i > 0 ? ", " : ""}
          <a
            href={source.url}
            className="underline decoration-line underline-offset-4 hover:text-fg"
            rel="nofollow noopener"
          >
            {source.label}
          </a>
        </span>
      ))}
      .
    </p>
  );
}

export function FeatureMatrix({ competitor }: { competitor: Competitor }) {
  return (
    <section className="pb-16">
      <Container>
        <h2 className="text-2xl font-medium tracking-tight text-fg">
          How do the features compare?
        </h2>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="bg-surface">
                <th className="px-5 py-4 text-left font-medium text-muted">Feature</th>
                <th className="px-5 py-4 text-left font-medium text-fg">{SITE.name}</th>
                <th className="px-5 py-4 text-left font-medium text-fg">{competitor.name}</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-line">
                  <th scope="row" className="px-5 py-4 text-left font-normal text-muted">
                    {row.label}
                  </th>
                  <td className="px-5 py-4">
                    <Cell value={PREQUEL_FEATURES[row.key]} />
                  </td>
                  <td className="px-5 py-4">
                    <Cell value={competitor.features[row.key]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <h3 className="text-[0.9375rem] font-medium text-fg">
            What {competitor.name} is good at
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{competitor.strength}</p>
        </div>
      </Container>
    </section>
  );
}

export function PricingCompare({ competitor }: { competitor: Competitor }) {
  return (
    <section className="pb-16">
      <Container>
        <h2 className="text-2xl font-medium tracking-tight text-fg">What does each one cost?</h2>

        <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
          {[
            { name: competitor.name, plans: competitor.plans },
            {
              name: SITE.name,
              plans: PLANS.map((plan) => ({
                name: plan.name,
                price: plan.price,
                cadence: plan.cadence,
              })),
            },
          ].map((product) => (
            <div key={product.name} className="bg-surface p-7">
              <h3 className="text-[0.9375rem] font-medium text-fg">{product.name}</h3>
              <ul className="mt-4 flex flex-col gap-3.5">
                {product.plans.map((plan) => (
                  <li key={plan.name} className="text-sm">
                    <span className="text-muted">{plan.name}</span>
                    <span className="mt-0.5 block text-fg">
                      {plan.price} <span className="text-muted">{plan.cadence}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Sourced competitor={competitor} className="mt-4" />
      </Container>
    </section>
  );
}
