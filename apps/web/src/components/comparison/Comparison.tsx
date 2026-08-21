import { Logo } from "@/components/Logo";
import { Container } from "@/components/Section";
import { Cell } from "@/components/Table";
import { WaitlistForm } from "@/components/WaitlistForm";
import {
  FEATURE_ROWS,
  PREQUEL_FEATURES,
  formatVerified,
  type Competitor,
} from "@/content/competitors";
import { PLANS } from "@/lib/pricing";
import { SITE } from "@/lib/site";

/**
 * The competitor's mark.
 *
 * `monogram` draws their initial in their own accent colour, on the same
 * superellipse the app icon uses. It is drawn here rather than fetched because
 * a third-party logo is an asset with terms attached — Apple's forbid it
 * outright — and a page that ships without one is better than a page that
 * ships with a broken image.
 *
 * Setting `mark: "asset"` on an entry reads `public/logos/<slug>.svg` instead.
 * That path uses a plain `<img>`: `next/image` refuses SVG unless
 * `dangerouslyAllowSVG` is set, and turning that on for files we did not draw
 * is not a trade worth making.
 */
function Mark({ competitor }: { competitor: Competitor }) {
  if (competitor.mark === "asset") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/logos/${competitor.slug}.svg`}
        alt=""
        width={64}
        height={64}
        className="squircle size-16 object-contain"
      />
    );
  }

  return (
    <div
      className="squircle flex size-16 items-center justify-center text-2xl font-medium text-white"
      style={{ backgroundColor: competitor.accent }}
      aria-hidden
    >
      {competitor.name.charAt(0)}
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
            <Logo size={64} radius={0.42} />
          </div>

          <h1 className="text-[2rem] leading-[1.05] font-normal tracking-tight text-balance text-fg sm:text-5xl">
            {competitor.heading}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted">
            {competitor.lede}
          </p>

          <div id="waitlist" className="mx-auto mt-9 max-w-lg scroll-mt-28">
            <WaitlistForm />
            <p className="mt-3.5 font-mono text-[11px] tracking-wide text-muted">
              {SITE.platform} · one email when the first build is ready
            </p>
          </div>
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
      // Built from `lib/pricing.ts` rather than written here, so the
      // placeholder prices there are corrected in one edit for all eleven.
      price: `${PLANS[0]?.price === "$0" ? "Free" : PLANS[0]?.price}, or ${PLANS[1]?.price} once`,
      free: "Free tier, no watermark",
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
