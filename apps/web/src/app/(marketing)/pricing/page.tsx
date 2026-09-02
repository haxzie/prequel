import type { Metadata } from "next";

import { ButtonLink } from "@/components/Button";
import { JsonLd } from "@/components/JsonLd";
import { Container, SectionHeading } from "@/components/Section";
import { FAQ, INCLUDED, PLANS } from "@/lib/pricing";
import { faqPageJsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Try Prequel free for 14 days. Buy it once for $29 if you record now and then, or $9 a month with unlimited storage if you record for work every week. Both are the whole app: automatic zooms, a perspective tilt, a framed camera, 4K export, transcripts and sharing, no watermark and no length limit.",
  path: "/pricing",
});

export default function Pricing() {
  return (
    <>
      <section className="pt-20 pb-4">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title="Try for free. Upgrade when you are ready."
            lede="Fourteen days with the whole app, then pick whichever fits. If you make a video now and then, buy it once and forget about it. If you are recording for work every week, Pro gives you unlimited storage for the links you share. It is the same app either way — the plan only decides how much you keep online."
            align="centre"
          />
        </Container>
      </section>

      <section className="py-14">
        <Container>
          {/* The width lives on this div, not on `Container`.
              `Container` sets `max-w-6xl` itself, and passing a narrower
              `max-w-*` through its `className` does nothing: Tailwind resolves
              two utilities from the same group by their order in the generated
              stylesheet, never by the order they appear in the attribute, and
              `6xl` is emitted after `2xl`. The class is accepted, overridden and
              silent — which is how these cards were full-bleed while the markup
              said otherwise.

              Two cards at a measure a pair reads at. The feature lists are
              identical bar one row, so the eye goes down them rather than
              across, and a card wide enough to set each line on one line stops
              looking like a price and starts looking like a panel. */}
          <div className="mx-auto grid w-full max-w-4xl gap-5 sm:grid-cols-2">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`squircle lit relative flex flex-col rounded-2xl border p-7 ${
                  plan.featured ? "border-brand-to/60 bg-elevated" : "border-line bg-surface"
                }`}
              >
                {/* On one card only. A badge on both would be furniture: it is
                    there to say where to start, and it cannot say that twice. The
                    words come from `lib/pricing.ts` with the rest of the claims —
                    "Recommended" is an opinion we hold, where "most popular" would
                    be a fact about sales we do not have. */}
                {plan.badge ? (
                  <span className="brand-gradient absolute -top-3 left-7 rounded-full px-3 py-1 text-[11px] font-medium text-white">
                    {plan.badge}
                  </span>
                ) : null}

                <h2 className="text-base font-medium text-fg">{plan.name}</h2>
                <p className="mt-1.5 text-sm text-muted">{plan.summary}</p>

                <p className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-medium tracking-tight text-fg">{plan.price}</span>
                  <span className="text-xs text-muted">{plan.cadence}</span>
                </p>
                {/* Per plan, because the two are not billed the same way. The
                    month, and only the month: there is no yearly rate, so an
                    annualised figure beside either of these would be a cadence
                    nobody is charged — the same trick this site calls out on
                    Screen Studio's own page, run the other way. */}
                <p className="mt-1.5 text-xs text-muted">{plan.billing}</p>
                <ButtonLink
                  href="/download"
                  variant={plan.featured ? "primary" : "secondary"}
                  className="mt-6 w-full"
                >
                  Download for Mac
                </ButtonLink>

                <ul className="mt-7 flex flex-col gap-3 border-t border-line pt-6 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-3 text-muted">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-lilac" aria-hidden />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-14">
        <Container>
          <h2 className="text-2xl font-medium tracking-tight text-fg">What you get</h2>
          {/* A list rather than a table: the two plans differ in one row, and a
              column of ticks identical everywhere but `Storage` says less than
              naming the difference does. */}
          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
            {INCLUDED.map(([label, value]) => (
              <div key={label} className="bg-surface px-5 py-5">
                <dt className="font-mono text-[11px] tracking-wider text-muted uppercase">
                  {label}
                </dt>
                <dd className="mt-1.5 text-sm text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <section className="py-14">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <h2 className="text-2xl font-medium tracking-tight text-fg">Questions</h2>
          <dl className="flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {FAQ.map((item) => (
              <div key={item.question} className="bg-bg px-6 py-6">
                <dt className="text-[0.9375rem] font-medium text-fg">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </Container>

        {/* Off the same array as the markup above, so the two cannot drift. */}
        <JsonLd data={faqPageJsonLd(FAQ)} />
      </section>
    </>
  );
}
