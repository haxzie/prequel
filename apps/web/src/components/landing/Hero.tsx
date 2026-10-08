import Link from "next/link";
import type { ReactNode } from "react";

import { Container, Eyebrow } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import { StarredBy } from "@/components/StarredBy";

type HeroProps = {
  /** A node and not a string: the home page draws three of its words as chips.
      Every other page passes a plain string, which is still one of these. */
  title: ReactNode;
  lede: string;
  /** Small caps line above the heading. The home page passes none. */
  eyebrow?: string;
  /**
   * The newest release, as a pill above the headline that opens the changelog.
   *
   * The home page passes it; the use-case pages do not, for the reason they
   * carry an eyebrow instead: a visitor who arrived at "record a demo" came
   * for that, and what shipped last week is the home page's news to tell.
   */
  release?: { version: string; highlight: string };
};

/**
 * How far apart the hero's rows start, in milliseconds.
 *
 * Well under the animation's own length, so the rows overlap heavily rather
 * than arriving one finished at a time. A stagger longer than the tail of the
 * ease reads as four separate entrances; this reads as one wave.
 */
const STAGGER_MS = 110;

/**
 * The block above the fold, on `/` and on every `/create/<slug>` page.
 *
 * Only the three strings differ between them. Everything else — the measures,
 * the form — is the same block, so it is one component rather
 * than a shape each page reproduces and slowly diverges from.
 */
export function Hero({ title, lede, eyebrow, release }: HeroProps) {
  // Delays handed out in source order as the rows are written, rather than a
  // fixed step per role. The eyebrow is conditional — the home page passes none
  // — and a fixed table leaves its slot empty there, opening a gap twice the
  // stagger under the pill while every other row stays 90ms apart. Counting
  // what is actually rendered keeps the rhythm even on both pages.
  //
  // A counter and not `nth-child` for the same reason: the selector counts DOM
  // positions, which is the thing that moves.
  let row = 0;
  const rise = () => ({ animationDelay: `${row++ * STAGGER_MS}ms` });

  return (
    // Nothing behind this block, and that is the whole design: paper and the
    // sentence. There used to be a WebGPU shader stack here — a drifting mesh
    // of the icon's sunrise, read as light pooling in a dark room — and it went
    // when the site did, because that idea has no light-theme equivalent and
    // it was 700kB to say it. The mark and the row of grey shapes flanking it
    // went after that: the pill already carries the brand colour, and a
    // 104px icon above a headline was a second thing to look at before the
    // sentence. The `relative` stays for the flow, not for a canvas to measure
    // itself against.
    <section className="relative pt-20 pb-16 sm:pt-28">
      <Container>
        {/* Centred, so `mx-auto` on every width-capped child rather than one
            wrapper: the measures differ on purpose — the headline is allowed to
            run wider than the paragraph, and the form narrower than both — and
            a single `max-w` would flatten that into one column. */}
        <div className="mx-auto max-w-3xl text-center">
          {/* The release badge, first in the wave. A link
              and not an announcement: the whole pill goes to the changelog, so
              the version is a way in rather than a label. The highlight is one
              short line — the `.mdx` promises that — and is allowed to wrap
              on a phone rather than truncate, because a badge that ends in an
              ellipsis says less than no badge. */}
          {release ? (
            <div
              data-hero-enter
              className="animate-hero-rise mb-6 flex justify-center"
              style={rise()}
            >
              <Link
                href="/docs/changelog"
                className="group inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-elevated py-1 pr-3.5 pl-1.5 text-sm text-muted transition-colors hover:border-fg/20 hover:text-fg"
              >
                <span className="rounded-full bg-brand-from px-2 py-0.5 font-mono text-xs font-medium text-white">
                  v{release.version}
                </span>
                <span className="text-pretty">{release.highlight}</span>
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </div>
          ) : null}
          {/* The rows that are wrapped rather than given the class directly —
              this one and the button below — are wrapped because `Eyebrow` and
              `DownloadCta` each take a `className` and nothing else. Both are
              used elsewhere, and widening two signatures so one caller can hang
              an animation off them is the wrong trade. */}
          {eyebrow ? (
            <div data-hero-enter className="animate-hero-rise" style={rise()}>
              <Eyebrow>{eyebrow}</Eyebrow>
            </div>
          ) : null}
          {/* The leading opens up only when the title contains a chip. A chip
              is taller than the letters around it and tilted on top of that, so
              at 1.05 the raised corner of one on the second line lands in the
              first — but a plain sentence wants the tight setting, and every
              page but the home one passes a plain sentence. `has-` asks the
              content rather than adding a prop each page has to get right. */}
          <h1
            data-hero-enter
            className="animate-hero-rise text-[2rem] leading-[1.05] font-normal tracking-tight text-balance text-fg has-[[data-hero-chip]]:leading-[1.5] sm:text-6xl"
            style={rise()}
          >
            {title}
          </h1>
          <p
            data-hero-enter
            className="animate-hero-rise mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted"
            style={rise()}
          >
            {lede}
          </p>

          <div data-hero-enter className="animate-hero-rise" style={rise()}>
            {/* On the button's own line, and under it on a narrow screen —
                `DownloadCta` handles both. The stack is a second glance at the
                call to action, and at 380px wide the two of them on one line is
                a fight for a row that fits one. */}
            <DownloadCta className="mt-9" beside={<StarredBy />} />
          </div>
        </div>
      </Container>
    </section>
  );
}
