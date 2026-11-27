import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/Section";
import { Toc } from "@/components/Toc";
import { TryPrequelCard } from "@/components/TryPrequelCard";
import type { DocSection, DocSlug } from "@/content/docs";
import type { Heading } from "@/lib/toc";

/**
 * The frame every docs page sits in: the section list, the article, and the
 * "On this page" list.
 *
 * Three columns at `xl`, two at `lg`, one below. The article keeps the site's
 * long-form measure (`max-w-2xl`) whatever the columns around it do, so a docs
 * page reads at the same width as a post or the changelog.
 *
 * `current` is `"changelog"` as well as a slug: the changelog is a page inside
 * the docs without being one of the Markdown pages, and it needs the same
 * highlight when it is the one open.
 */
export function DocsShell({
  sections,
  current,
  toc = [],
  children,
}: {
  sections: DocSection[];
  current?: DocSlug | "changelog";
  toc?: Heading[];
  children: ReactNode;
}) {
  const active = sections.find((section) => section.pages.some((page) => page.slug === current));
  const where = current === "changelog" ? "Changelog" : (active?.title ?? "Overview");

  return (
    <Container className="py-14 lg:py-20">
      {/* The rail is 14rem, where it was 11, and the gap narrows at `xl` to
          pay for it: the card under the contents has a full-width button with
          "Download for Mac" on it, and at 11rem that wraps onto two lines. The
          article gives up 1rem of the 37 it had; the gap gives up 2. */}
      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14 xl:grid-cols-[13rem_minmax(0,1fr)_14rem] xl:gap-10">
        {/* The list, twice. Sticky on the left from `lg`, and folded into a
            disclosure above the article below it. A native `<details>` rather
            than the header's `NavMenu`: that component is a client component
            because it has to close on Escape and on navigation, and a
            `<details>` needs neither — the page it opens onto is a fresh
            render, so it arrives closed. No JavaScript is what a docs page
            should cost. */}
        <details className="group rounded-2xl border border-line bg-elevated lg:hidden">
          <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 text-sm font-medium text-fg marker:content-none [&::-webkit-details-marker]:hidden">
            <span>
              <span className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Docs</span>
              <span className="mx-2 text-muted" aria-hidden>
                ·
              </span>
              {where}
            </span>
            <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="border-t border-line px-3 py-3">
            <SectionList sections={sections} current={current} />
          </div>
        </details>

        <nav
          aria-label="Documentation"
          className="hidden self-start lg:sticky lg:top-8 lg:block lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto"
        >
          <SectionList sections={sections} current={current} />
        </nav>

        {/* `min-w-0` on the article's column: a wide code block or table would
            otherwise stretch the grid track and push the sidebar off the
            rail. `minmax(0, 1fr)` in the template is the same guard written
            on the grid; both are needed for Safari. */}
        <div className="min-w-0">
          <article className="mx-auto max-w-2xl lg:mx-0">{children}</article>
        </div>

        {/* A column with the scroll on the contents alone, so the card under
            them is always on screen. The same shape a blog post's rail uses,
            and for the same reason: a long page's contents are taller than the
            viewport, and a rail that scrolls as one piece puts the card below
            the fold of a sticky element where the page's own scrollbar cannot
            reach it. `min-h-0` is what lets the list shrink inside the flex
            column instead of pushing the card back out of it. */}
        {toc.length >= 2 ? (
          <aside className="hidden self-start xl:sticky xl:top-8 xl:flex xl:max-h-[calc(100dvh-4rem)] xl:flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Toc headings={toc} />
            </div>
            <div className="mt-6 shrink-0">
              <TryPrequelCard />
            </div>
          </aside>
        ) : null}
      </div>
    </Container>
  );
}

function SectionList({
  sections,
  current,
}: {
  sections: DocSection[];
  current?: DocSlug | "changelog";
}) {
  return (
    <div className="flex flex-col gap-7">
      {sections.map((section) => (
        <div key={section.id}>
          <p className="mb-2 px-2.5 font-mono text-xs tracking-[0.18em] text-muted uppercase">
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.pages.map((page) => (
              <li key={page.slug}>
                <NavLink href={page.path} active={page.slug === current}>
                  {page.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* The changelog, on its own at the foot of the list. It is not a
          section — one page, and not written in the same Markdown shape — but
          it is the page a reader of the docs asks for next, which is why it
          came in here from the header. */}
      <div>
        <p className="mb-2 px-2.5 font-mono text-xs tracking-[0.18em] text-muted uppercase">
          Releases
        </p>
        <ul>
          <li>
            <NavLink href="/docs/changelog" active={current === "changelog"}>
              Changelog
            </NavLink>
          </li>
        </ul>
      </div>
    </div>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: `/docs/${string}`;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // The current page is told apart by a fill rather than by colour alone:
      // the links are already at `--fg`, the same hover tint the header uses,
      // and a bolder weight would make the list jitter as the selection moves.
      className={`block rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
        active ? "bg-fg/8 text-fg" : "text-muted hover:bg-fg/8 hover:text-fg"
      }`}
    >
      {children}
    </Link>
  );
}
