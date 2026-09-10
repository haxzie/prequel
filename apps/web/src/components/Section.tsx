import type { ReactNode } from "react";

import { ButtonLink } from "@/components/Button";
import { ArrowRightIcon } from "@/components/icons";

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs tracking-[0.18em] text-muted uppercase">{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  cta,
  align = "left",
  level = 2,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  /**
   * The words on the section's own call to action, or nothing for a section
   * without one.
   *
   * A string and not a node, for the reason `eyebrow` is one: the shape of the
   * button — where it links, which variant, which size — is the same on every
   * section and belongs in one place. Seven callers each writing their own
   * `ButtonLink` is seven chances for one of them to end up a different size
   * from the rest, which is exactly the drift a shared heading exists to stop.
   *
   * Every one of them goes to `/download`, which resolves the current build. The
   * words differ because a page that says "Download for Mac" seven times reads
   * as one banner repeated, and because each section has earned a different ask
   * by the point it is reached.
   */
  cta?: string;
  align?: "left" | "centre";
  /**
   * Which heading level the title renders at.
   *
   * `h2` by default, because most callers are one section of a page whose `h1`
   * is the hero above them. The pages with no hero — `/pricing`, `/features`,
   * `/blog`, `/about`, `/changelog`, `/support`, `/usecases` — open with this
   * component instead, and an `h2` there leaves the page with no `h1` at all.
   * Nothing about that shows on screen, which is why all seven shipped that
   * way; to a crawler it is a page that never says what it is about.
   */
  level?: 1 | 2;
}) {
  const centred = align === "centre";
  // A tag name, not a second block of markup: the classes below are the whole
  // of the heading's look and must not fork per level, or the one `h1` on the
  // site drifts a size away from every `h2`.
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={`max-w-2xl ${centred ? "mx-auto text-center" : ""}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      {/* The leading relaxes only where a chipped word is present, which is the
          same `has-` variant the hero uses and for the same reason: a chip is a
          box around a word, and at the heading's default line height two
          chipped lines sit close enough to touch. A heading of plain words is
          left exactly as it was. */}
      <Heading className="text-3xl font-medium tracking-tight text-balance text-fg has-[[data-heading-chip]]:leading-[1.35] sm:text-4xl">
        {title}
      </Heading>
      {lede ? <p className="mt-4 text-lg leading-relaxed text-pretty text-muted">{lede}</p> : null}
      {/* `size="sm"` and not the hero's. The hero's button is the page's ask and
          these are a section's, so they are deliberately a step quieter — seven
          buttons at the hero's size read as seven equal demands and flatten the
          one that matters. Centred sections need nothing extra: the wrapper's
          `text-center` centres an inline-level element on its own.

          The arrow nudges right on hover, which is the whole of the interaction:
          `transform` only, so it composites, and the group is the button rather
          than the icon because the pointer is over the label as often as over
          the mark. `motion-reduce` stops it — a 3px slide is small enough to
          argue about and the setting is not ours to second-guess. */}
      {cta ? (
        <div className="mt-7">
          <ButtonLink href="/download" size="sm" className="group">
            {cta}
            <ArrowRightIcon className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
