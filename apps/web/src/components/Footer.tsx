import type { ReactNode } from "react";
import Link from "next/link";

import { competitors } from "@/content/competitors";
import { useCases } from "@/content/use-cases";
import { CONTACT_EMAIL, NAV, SITE } from "@/lib/site";

import { Logo } from "./Logo";
import { Container } from "./Section";
import { DownloadCta } from "./DownloadButton";

/**
 * `badge` is the marketing layout's `@badge` slot, which is filled on the home
 * page and empty everywhere else. It arrives as a prop because a footer that
 * decided this for itself would have to know the route, and a layout does not.
 */
export function Footer({ badge }: { badge?: ReactNode }) {
  return (
    <footer className="mt-32 border-t border-line">
      <Container className="grid gap-12 py-16 md:grid-cols-[1fr_1.7fr]">
        <div>
          <Link href="/" className="flex items-center gap-2.5" aria-label="Prequel home">
            <Logo size={32} />
            <span className="text-base font-medium tracking-tight text-fg">Prequel</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">{SITE.description}</p>
          <DownloadCta className="mt-6 max-w-md" />
        </div>

        {/* Three groups rather than a flex row: the middle one carries sixteen
            links, and a wrapping flex row that right-aligns its second line
            reads as a mistake. `auto_1fr_auto` lets the use cases take the slack
            and keeps the two short columns at their content width. */}
        <div className="grid gap-x-10 gap-y-10 sm:grid-cols-[auto_1.5fr_1fr_auto] sm:gap-x-12">
          <nav className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-fg">Site</span>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted hover:text-fg">
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Every use-case page links to every other one through this column,
              which is what makes the set crawlable without a `/create` index.
              That is why it carries all of them rather than a curated few.

              The href is built here rather than stored on the registry entry:
              `Route` resolves its generic to `string`, and `string` does not
              extend the generated `/create/${SafeSlug<…>}`, so a field typed
              `Route` would reject every one of these. `Link` infers it from the
              literal instead — the same thing `blog/page.tsx` does. */}
          <nav className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm">
            <span className="col-span-2 font-medium text-fg">Use cases</span>
            {useCases.map((useCase) => (
              <Link
                key={useCase.slug}
                href={`/create/${useCase.slug}`}
                className="text-muted hover:text-fg"
              >
                {useCase.navLabel}
              </Link>
            ))}
          </nav>

          {/* Same reasoning as the use cases above: the comparison pages have no
              index either, so this column is what makes them crawlable. */}
          <nav className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:grid-cols-1">
            <span className="col-span-2 font-medium text-fg sm:col-span-1">Alternatives</span>
            {competitors.map((competitor) => (
              <Link
                key={competitor.slug}
                href={`/alternatives/${competitor.slug}`}
                className="text-muted hover:text-fg"
              >
                {competitor.navLabel}
              </Link>
            ))}
          </nav>

          {/* The support page before the address: somebody whose export just
              failed gets further from the permission answers on it than from an
              empty compose window, and the page carries the address anyway. */}
          <div className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-fg">Contact</span>
            <Link href="/support" className="text-muted hover:text-fg">
              Support
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-muted hover:text-fg">
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </Container>

      <Container className="flex flex-col items-start gap-4 border-t border-line py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p>© {new Date().getFullYear()} Prequel. Made for macOS.</p>
        {badge}
        <p className="font-mono tracking-wide">{SITE.platform}</p>
      </Container>
    </footer>
  );
}
