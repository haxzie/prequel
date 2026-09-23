import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/Section";
import type { DocSection, DocSlug } from "@/content/docs";
import type { Heading } from "@/lib/toc";

import { DocsToc } from "./DocsToc";

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
      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14 xl:grid-cols-[13rem_minmax(0,1fr)_11rem]">
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

        {toc.length >= 2 ? (
          <aside className="hidden self-start xl:sticky xl:top-8 xl:block">
            <DocsToc headings={toc} />
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
