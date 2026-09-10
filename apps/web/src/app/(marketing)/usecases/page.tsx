import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import { Container, SectionHeading } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import { JsonLd } from "@/components/JsonLd";
import { useCases, type UseCaseGroup } from "@/content/use-cases";
import { itemListJsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Use cases",
  description:
    "What people record with Prequel: product demos, onboarding, training, course lessons, tutorials, bug reports and launch videos, each with the setup that suits it.",
  path: "/usecases",
});

/**
 * The bands, in the order they are read.
 *
 * This page owns the order and the labels; `content/use-cases.ts` owns only
 * which band an entry is in. The registry's own array order is the footer's and
 * is left alone — grouping here is a filter, never a sort, so a page cannot move
 * in the footer because somebody re-worded a heading on this one.
 *
 * `tint` is here and not on the entry for the same reason: it colours the band,
 * not the card. Sixteen cards each with their own hue is a rainbow, and a hue
 * that means nothing is decoration — five that track the bands are the grouping
 * said a second way, which is the only argument for putting colour on this page
 * at all.
 *
 * Every one is an existing token, so both themes are already handled. `positive`
 * and `lilac` are redefined under `prefers-color-scheme: dark` and the other
 * three are legible on both grounds as they stand; `brand-to` is deliberately
 * not in the set, because #ac1860 on #0b0d11 is a shape you have to look for.
 */
const GROUPS: { key: UseCaseGroup; label: string; lede: string; tint: string }[] = [
  {
    key: "demos",
    tint: "text-brand-from",
    label: "Demos and launches",
    lede: "Showing the product to somebody who has not seen it before, and has not agreed to watch for very long.",
  },
  {
    key: "teaching",
    tint: "text-accent",
    label: "Teaching and onboarding",
    lede: "Recorded once, watched by everyone who needs it. The kind of video whose value is that it is not a meeting.",
  },
  {
    key: "publishing",
    tint: "text-lilac",
    label: "Publishing",
    lede: "Made to be posted, in the shape the platform wants it in.",
  },
  {
    key: "engineering",
    tint: "text-positive",
    label: "Engineering",
    lede: "Small text, read closely, by people who will pause the video to look at it.",
  },
  {
    key: "capability",
    tint: "text-iris",
    label: "Ways to record",
    lede: "The two questions people ask before anything else.",
  },
];

export default function UseCases() {
  return (
    <>
      <JsonLd
        data={itemListJsonLd(
          useCases.map((useCase) => ({ name: useCase.heading, path: `/create/${useCase.slug}` })),
        )}
      />

      <section className="pt-20 pb-10">
        <Container>
          <SectionHeading
            eyebrow="Use cases"
            title="What people record with Prequel"
            lede="One short page for each kind of video. Pick whichever is closest to what you are making: each says what usually goes wrong with it, and which part of Prequel is the answer."
            align="centre"
          />
          <DownloadCta className="mt-10" />
        </Container>
      </section>

      {GROUPS.map((group) => {
        const entries = useCases.filter((useCase) => useCase.group === group.key);

        return (
          <section key={group.key} className="pb-20">
            <Container>
              <SectionHeading title={group.label} lede={group.lede} />

              {/* Bordered cards with a gap rather than the site's usual `gap-px`
                  over a `bg-line` parent. These bands are five, four, two and
                  three long, so most of them end mid-row, and a parent showing
                  through the gaps also shows through the cells no card landed
                  in — a solid block of `--line` where a card ought to be. */}
              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map((useCase) => (
                  /* The href is a literal rather than a field on the registry
                     entry. `Route` resolves its generic to `string`, and `string`
                     does not extend the generated `/create/${SafeSlug<…>}`, so a
                     stored field typed `Route` is rejected for every one of
                     these. `Link` infers it from the template instead — the same
                     thing `Footer.tsx` does with the same set. */
                  <Link
                    key={useCase.slug}
                    href={`/create/${useCase.slug}`}
                    className="group rounded-2xl border border-line bg-surface p-7 transition-colors hover:border-muted/40 hover:bg-elevated"
                  >
                    {/* The mark and the eyebrow share a row rather than
                        stacking. These cards are already three lines of prose
                        tall and the bands are up to five long, so a tile on its
                        own line adds a row of height to every card on the page
                        to say what the row below it already says. */}
                    <div className="flex items-center gap-3">
                      {/* The band's colour is set once, here, and the fill, the
                          edge and the icon are all drawn from it: `bg-current`
                          and `border-current` resolve against the `text-` class
                          the group carries, so a tint is one token rather than
                          three that can be changed apart from each other.

                          The fill and the edge are held down at 10% and 20%. At
                          full strength these are five saturated discs down a
                          page that is otherwise paper and a hairline, and they
                          become the thing the eye lands on instead of the
                          headings. The icon is the only part at full colour, and
                          it is 17px of 1.75px stroke, which is about as much of
                          a hue as this page can carry. */}
                      <span
                        className={
                          "flex size-9 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-current/10 transition-colors group-hover:bg-current/[0.18] " +
                          group.tint
                        }
                      >
                        <useCase.icon className="size-[1.05rem]" strokeWidth={1.75} aria-hidden />
                      </span>
                      <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
                        {useCase.eyebrow}
                      </p>
                    </div>
                    <h3 className="mt-4 text-[0.9375rem] font-medium text-fg">{useCase.heading}</h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-muted">{useCase.lede}</p>
                  </Link>
                ))}
              </div>
            </Container>
          </section>
        );
      })}

      <section className="pb-20">
        <Container>
          <div className="squircle lit relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-14 text-center sm:px-16">
            <div className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-px opacity-70" />
            <h2 className="text-2xl font-medium tracking-tight text-fg">
              None of these quite it?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-muted">
              Every one of these is the same app. The features page is the whole list of what
              Prequel does to a recording.
            </p>
            <DownloadCta className="mt-8" />
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/features" variant="secondary" size="sm">
                All the features
              </ButtonLink>
              <ButtonLink href="/pricing" variant="secondary" size="sm">
                Pricing and licences
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
