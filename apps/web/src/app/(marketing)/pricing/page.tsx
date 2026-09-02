import type { Metadata } from "next";

import { ButtonLink } from "@/components/Button";
import { JsonLd } from "@/components/JsonLd";
import { Container, SectionHeading } from "@/components/Section";
import { FAQ, INCLUDED, PLANS } from "@/lib/pricing";
import { faqPageJsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Prequel is $9 a month, or $29 once for a lifetime licence, with a 14-day free trial. Both are the whole app — automatic zooms, a perspective tilt, a framed camera, 4K export, transcripts and sharing, no watermark and no length limit. Storage is the only difference.",
  path: "/pricing",
});

export default function Pricing() {
  return (
    <>
      <section className="pt-20 pb-4">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title="Two ways to pay. One app."
            lede="Every recording comes out directed — zooms that follow the work, a perspective tilt, focus falling away from the subject, a camera framed afterwards. Both plans have all of it: nothing is held back on the cheaper one, and the only difference is how much you can keep on a shareable link. Introductory while Prequel is new, so the rate goes up later; this is what it costs today."
            align="centre"
          />
        </Container>
      </section>

      <section className="py-14">
        {/* Two cards, held to a measure a pair reads at rather than stretched
            across the container — the feature lists are identical bar one row,
            and the eye compares them line by line. */}
        <Container className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`squircle lit relative flex flex-col rounded-2xl border p-7 ${
                plan.featured ? "border-brand-to/60 bg-elevated" : "border-line bg-surface"
              }`}
            >
              {/* On the featured card only. A badge on both would be furniture:
                  it is there to say where to start, and it cannot say that
                  twice. Early bird, not "most popular" — the plans have not been
                  on sale long enough for that to be a fact rather than a nudge. */}
              {plan.featured ? (
                <span className="brand-gradient absolute -top-3 left-7 rounded-full px-3 py-1 text-[11px] font-medium text-white">
                  Early bird
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
              {/* Says the rate is introductory and nothing more. No struck-out
                  regular price, because there is not one to strike out, and no
                  promise that this rate is kept for life — that is a commitment
                  to honour on every early licence indefinitely, and it is not
                  one this page is allowed to invent. */}
              <p className="mt-3 text-xs text-lilac">
                Introductory pricing while Prequel is new. It goes up later.
              </p>

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
