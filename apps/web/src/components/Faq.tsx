import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { JsonLd } from "@/components/JsonLd";
import { Container, Eyebrow } from "@/components/Section";
import type { FaqEntry } from "@/lib/faq";
import { faqPageJsonLd } from "@/lib/seo";

/**
 * A page's questions, rendered as copy and as `FAQPage` structured data.
 *
 * One component rather than a block each page reproduces. It lived inside
 * `LandingBody` until the free tools needed the same section, and a second copy
 * of it would have been a second answer to "is the first one open" and a second
 * place to forget the JSON-LD.
 *
 * The heading is a prop because it is spoken English about the page it is on:
 * `Zooms, exports and the rest` on the landing page, and something else
 * wherever else this appears. `Frequently asked questions` is what this
 * component exists to avoid.
 */
export function Faq({ heading, entries }: { heading: string; entries: FaqEntry[] }): ReactNode {
  return (
    <section id="faq" className="scroll-mt-16 pt-24">
      <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="text-2xl font-medium tracking-tight text-balance text-fg">{heading}</h2>
        </div>

        {/*
          Every answer is rendered in full, always. An accordion would hide most
          of this behind a click; `<details>` would at least keep it in the DOM,
          but plain markup removes the question entirely — for crawlers and for
          anyone who wants to skim or search the page with ⌘F.
        */}
        <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
          {entries.map((item, i) => (
            <details
              key={item.question}
              // The first one open, so the section does not read as a wall of
              // closed rows with nothing to show for itself.
              open={i === 0}
              className="faq-item group bg-bg"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-6 py-5 text-[0.9375rem] font-medium text-fg [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  className="mt-0.5 size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-6 pb-5 text-sm leading-relaxed text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>

      {/* FAQPage structured data, off the same array as the markup above so the
          two cannot drift apart. Google restricted FAQ rich results to a
          narrow set of sites in 2023, so treat this as machine-readable
          context rather than a ticket to a rich snippet. */}
      <JsonLd data={faqPageJsonLd(entries)} />
    </section>
  );
}
