import type { Metadata } from "next";

import { Container, SectionHeading } from "@/components/Section";
import { RELEASES } from "@/content/changelog";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Changelog",
  description:
    "Every release of Prequel, newest first: what shipped, when, and what it means for a recording.",
  path: "/changelog",
});

/**
 * The releases, as a vertical timeline.
 *
 * A rail down the left with a node per release, which is the shape the app's
 * own timeline has and the reason to draw it that way here: a changelog is a
 * sequence of moments, and a stack of cards says only that there are several.
 *
 * The rail is a border on the list rather than an element of its own, so it
 * cannot fall out of step with the items beside it. Each node is drawn over that
 * border by its own ring, which is what makes it read as a point on the line
 * rather than a bullet next to one.
 *
 * One centred measure for the whole page, and a narrow one. The container is as
 * wide as the landing page's, which is right for a picture beside a paragraph
 * and wrong for a column of prose: a line of this text ran the better part of a
 * thousand pixels and the eye lost its place returning to the left.
 */
const MEASURE = "mx-auto max-w-2xl";

export default function Changelog() {
  return (
    <>
      <section className="pt-20 pb-10">
        <Container>
          <div className={MEASURE}>
            <SectionHeading
              eyebrow="Changelog"
              title="What we shipped"
              lede="Prequel updates itself, so you are usually on the newest of these already. The app tells you when there is one waiting."
            />
          </div>
        </Container>
      </section>

      <section className="pb-24">
        <Container>
          <ol className={`${MEASURE} border-l border-line pl-7 sm:pl-9`}>
            {RELEASES.map((release) => (
              <li key={release.version} className="relative pb-12 last:pb-0">
                {/* The node. `bg-bg` on the ring is what hides the rail behind
                    it, so the line reads as passing through the point rather
                    than under it. */}
                <span
                  aria-hidden
                  className="absolute top-[0.4rem] -left-[2rem] size-2.5 rounded-full bg-brand-from ring-4 ring-bg sm:-left-[2.5rem]"
                />

                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="font-mono text-base font-medium text-fg">v{release.version}</h2>
                  <time dateTime={release.date} className="text-sm text-muted">
                    {new Date(release.date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </time>
                </div>

                {/* Discs rather than bare lines. Without a marker the entries
                    read as loose sentences under a date, and a release with
                    four of them reads as a paragraph that has lost its joins.
                    White, so the markers sit with the text rather than tinting
                    the column: the one coloured thing on the page is the node
                    on the rail, which is what says where a release begins. */}
                <ul className="mt-3.5 list-disc space-y-2.5 pl-5 marker:text-white">
                  {release.items.map((item) => (
                    <li key={item} className="pl-1 leading-relaxed text-fg/85">
                      {item}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Container>
      </section>
    </>
  );
}
