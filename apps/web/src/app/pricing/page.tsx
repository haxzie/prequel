import type { Metadata } from "next";

import { ButtonLink } from "@/components/Button";
import { Container, SectionHeading } from "@/components/Section";
import { COMPARISON, FAQ, PLANS } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Prequel plans: a free tier with the whole recorder, Pro for 4K and automatic zooms, and Team for shared presets.",
};

function Tick({ on }: { on: boolean }) {
  return on ? (
    <svg width="14" height="14" viewBox="0 0 14 14" className="text-fg" aria-hidden>
      <path
        d="M2.5 7.5 5.5 10.5 11.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <span className="block h-px w-3 bg-line" aria-hidden />
  );
}

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === "string") return <span className="text-fg">{value}</span>;
  return (
    <>
      <Tick on={value} />
      <span className="sr-only">{value ? "Included" : "Not included"}</span>
    </>
  );
}

export default function Pricing() {
  return (
    <>
      <section className="pt-20 pb-4">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title="Free to record. Paid to go further."
            lede="Nothing is for sale yet — Prequel is still in development. These are the plans it will ship with, so you can see now what stays free."
            align="centre"
          />
        </Container>
      </section>

      <section className="py-14">
        <Container className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`squircle lit relative flex flex-col rounded-2xl border p-7 ${
                plan.featured ? "border-brand-to/60 bg-elevated" : "border-line bg-surface"
              }`}
            >
              {plan.featured ? (
                <span className="brand-gradient absolute -top-3 left-7 rounded-full px-3 py-1 text-[11px] font-medium text-white">
                  Most popular
                </span>
              ) : null}

              <h2 className="text-base font-medium text-fg">{plan.name}</h2>
              <p className="mt-1.5 text-sm text-muted">{plan.summary}</p>

              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-4xl font-medium tracking-tight text-fg">{plan.price}</span>
                <span className="text-xs text-muted">{plan.cadence}</span>
              </p>

              <ButtonLink
                href="/#waitlist"
                variant={plan.featured ? "primary" : "secondary"}
                className="mt-6 w-full"
              >
                Join the waitlist
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
          <h2 className="text-2xl font-medium tracking-tight text-fg">Compared</h2>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="bg-surface">
                  <th className="px-5 py-4 text-left font-medium text-muted">Feature</th>
                  {PLANS.map((plan) => (
                    <th key={plan.name} className="px-5 py-4 text-left font-medium text-fg">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([feature, ...values]) => (
                  <tr key={feature} className="border-t border-line">
                    <th scope="row" className="px-5 py-4 text-left font-normal text-muted">
                      {feature}
                    </th>
                    {values.map((value, i) => (
                      <td key={i} className="px-5 py-4">
                        <Cell value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      </section>
    </>
  );
}
