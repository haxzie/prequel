import Link from "next/link";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/Button";
import { DownloadCta } from "@/components/DownloadButton";
import { Container, SectionHeading } from "@/components/Section";
import { freeTools, type FreeTool } from "@/content/free-tools";

/**
 * Everything under the tool itself, shared by all three tool pages.
 *
 * The steps, the feature cards and the questions come off the registry entry,
 * so the three pages are the same page with different content rather than three
 * layouts that have to be kept looking alike. The strings are each page's own:
 * the lesson from the use-case set is that a shared array across pages built to
 * rank for different phrases is duplicate content with extra steps.
 */
const VERB = {
  recorder: "Recording",
  editor: "Editing",
  converter: "Converting",
} as const;

export function ToolBody({ tool }: { tool: FreeTool }): ReactNode {
  /**
   * Four related tools, its own kind first.
   *
   * It listed every other tool, which was fine at three and is eleven cards of
   * tail on a page now. Same kind first because that is what the reader is
   * after: somebody converting a MOV wants the other converters, and the link
   * from a converter to the screen recorder is the one the band at the top of
   * the page already makes.
   */
  const others = [...freeTools]
    .filter((other) => other.slug !== tool.slug)
    .sort((a, b) => {
      const kin = (entry: FreeTool) => (entry.surface.kind === tool.surface.kind ? 0 : 1);
      return kin(a) - kin(b);
    })
    .slice(0, 4);

  return (
    <>
      <section id="how-to" className="scroll-mt-16 pt-20 pb-8">
        <Container>
          {/* The verb comes off the surface. It said "Recording" for every
              tool, which was true of the three it was written for and wrong the
              day the screenshot editor landed. */}
          <SectionHeading
            eyebrow="How it works"
            title={`${VERB[tool.surface.kind]} in ${tool.steps.length} steps`}
            align="centre"
          />
          {/* An `ol`, because these are a sequence: read in another order they
              stop being true. The same markup as the landing page's three
              steps, without the pictures, which here would be screenshots of
              the thing running directly above them. */}
          <ol className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {tool.steps.map((step, index) => (
              <li
                key={step.name}
                className="flex flex-col gap-2.5 rounded-2xl border border-line bg-bg p-6"
              >
                <span className="font-mono text-xs tracking-wider text-muted" aria-hidden>
                  {index + 1}
                </span>
                <span className="text-[0.9375rem] font-medium text-fg">{step.name}</span>
                <span className="text-sm leading-relaxed text-muted">{step.text}</span>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="pt-16">
        <Container>
          <SectionHeading
            eyebrow="What it does"
            title="Free, and still worth using"
            align="centre"
          />
          {/* The hairline grid the landing page's feature cards use: a gap
              shows the parent through the cells no card landed in, and these
              sets are four and six long. */}
          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {tool.features.map((feature) => (
              <div key={feature.title} className="bg-bg p-7">
                <h3 className="text-[0.9375rem] font-medium text-fg">{feature.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{feature.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="pt-20">
        <Container>
          <div className="squircle lit relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-14 sm:px-14">
            <div className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-px opacity-70" />
            <div className="grid items-center gap-10 lg:grid-cols-[1.3fr_1fr]">
              <div>
                <h2 className="text-2xl font-medium tracking-tight text-balance text-fg sm:text-3xl">
                  On a Mac, the editing is already done
                </h2>
                <p className="mt-4 max-w-xl text-pretty text-muted">
                  Prequel records your screen at its full resolution, then opens an editor with the
                  zooms already placed, your camera framed and a background applied. Export one MP4
                  at up to 4K.
                </p>
                <DownloadCta className="mt-8" bare />
              </div>
              {/* The five things that are done by the time the editor opens.
                  Kept short: this band is an aside on a page whose job is the
                  tool above it. */}
              <ul className="flex flex-col gap-3 text-sm">
                {[
                  "Zooms placed on every click",
                  "Camera shaped, sized and framed",
                  "Background, padding and shadow",
                  "Microphone and system on separate gains",
                  "Cursor smoothed and resized",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-muted">
                    <span
                      className="mt-1.5 size-1.5 flex-none rounded-full bg-brand-from"
                      aria-hidden
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      <section className="pt-20">
        <Container>
          <SectionHeading eyebrow="More tools" title="The rest of them" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {others.map((other) => (
              <Link
                key={other.slug}
                href={`/free-tools/${other.slug}`}
                className="group rounded-2xl border border-line bg-surface p-7 transition-colors hover:border-muted/40 hover:bg-elevated"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-current/10 text-brand-from">
                    <other.icon className="size-[1.05rem]" strokeWidth={1.75} aria-hidden />
                  </span>
                  <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
                    {other.eyebrow}
                  </p>
                </div>
                <h3 className="mt-4 text-[0.9375rem] font-medium text-fg">{other.name}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{other.summary}</p>
              </Link>
            ))}
          </div>
          <div className="mt-8">
            <ButtonLink href="/free-tools" variant="secondary" size="sm">
              All free tools
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
