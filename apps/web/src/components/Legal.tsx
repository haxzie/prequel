import Link from "next/link";

import { Container, Eyebrow } from "@/components/Section";

/**
 * One clause of a legal page.
 *
 * `body` is an array of plain strings rather than children, which keeps the two
 * pages as data and means neither can quietly grow a class name of its own. If a
 * clause ever genuinely needs a link inside a sentence, that is the moment to
 * widen this, not before.
 */
export type LegalSection = {
  /**
   * The anchor somebody pastes when they want to point at one clause rather than
   * the whole page, so it is written out rather than derived from the heading.
   * A slug built from the heading would change the moment the heading is reworded,
   * silently breaking every link anybody had saved.
   */
  id: string;
  heading: string;
  body: string[];
  /** A bulleted list under the paragraphs, where a clause is really a set. */
  list?: string[];
};

/**
 * The shape both `/privacy` and `/terms` are drawn in.
 *
 * Shared rather than written twice for the reason the rest of the tree is: two
 * implementations of one page is how the privacy page comes to carry a contents
 * list and the terms page does not, which reads as one of them being an
 * afterthought. The content is the only thing that differs, and it arrives as
 * data.
 *
 * No `cta` anywhere on either page. Somebody reading the terms before they buy
 * is doing diligence, and a download button in the middle of it is the product
 * talking over them.
 */
export function LegalPage({
  title,
  lede,
  updated,
  sections,
}: {
  title: string;
  lede: string;
  /** Written out, because a reader checks a policy's date before its contents. */
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <Container className="py-20">
      {/* One centred column for the heading and the prose under it, which is
          what `blog/[slug]` does and for the same reason: this is long-form text
          rather than a landing section, and a `max-w-2xl` block left-aligned
          inside a `max-w-6xl` container leaves half the page empty beside it.

          The title is an `h1` rather than `SectionHeading`, which emits an `h2`.
          On a landing page that is right, because the page's own name is in the
          hero above it. Here the title *is* the page. */}
      <article className="mx-auto max-w-2xl">
        <header>
          <Eyebrow>Legal</Eyebrow>
          <h1 className="text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-pretty text-muted">{lede}</p>
          <p className="mt-6 font-mono text-xs tracking-wider text-muted uppercase">
            Last updated {updated}
          </p>
        </header>

        <hr className="my-10 border-line" />

        {/* Plain anchors, no scroll spy. Fourteen clauses is too many to
            scan for and the jump list is the whole of what a reader wants
            from one, so it costs a list and no JavaScript. */}
        <nav aria-label="On this page" className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-[0.9375rem] font-medium text-fg">On this page</h2>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.id}>
                <Link href={`#${section.id}`} className="text-muted hover:text-fg">
                  {section.heading}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-14 flex flex-col gap-12">
          {sections.map((section) => (
            // `scroll-mt` so a jumped-to heading does not land under the sticky
            // nav, which is how an anchor comes to look broken.
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-xl font-medium tracking-tight text-fg">{section.heading}</h2>
              <div className="mt-4 flex flex-col gap-4">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-[1.0625rem] leading-relaxed text-muted">
                    {paragraph}
                  </p>
                ))}
              </div>
              {section.list ? (
                <ul className="mt-5 flex flex-col gap-3 border-l border-line pl-5">
                  {section.list.map((item) => (
                    <li key={item} className="text-[1.0625rem] leading-relaxed text-muted">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </article>
    </Container>
  );
}
