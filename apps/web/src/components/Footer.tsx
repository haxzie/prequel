import Link from "next/link";

import { competitors } from "@/content/competitors";
import { freeTools } from "@/content/free-tools";
import { useCases } from "@/content/use-cases";
import { CONTACT_EMAIL, FOOTER_NAV, SITE } from "@/lib/site";

import { Logo } from "./Logo";
import { Container } from "./Section";
import { DownloadCta } from "./DownloadButton";

export function Footer() {
  return (
    <footer className="mt-32 border-t border-line">
      {/* Two rows. The top one is the brand beside the links a visitor
          actually comes to a footer for — the site pages and the address.
          The three long lists are an SEO path to pages the header does not
          link, so they sit beneath: placed beside the brand, their five
          columns need about a thousand pixels against the six hundred and
          fifty that half of a 72rem container has, and the `fr` columns
          were crushed to one word per line and overlapped. */}
      <Container className="grid gap-12 py-16 md:grid-cols-[1fr_1.7fr]">
        <div>
          <Link href="/" className="flex items-center gap-2.5" aria-label="Prequel home">
            <Logo size={32} />
            <span className="text-base font-medium tracking-tight text-fg">Prequel</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">{SITE.description}</p>
          <DownloadCta className="mt-6 max-w-md" bare />
        </div>

        <div className="grid gap-x-10 gap-y-10 sm:grid-cols-[auto_auto] sm:justify-end sm:gap-x-24">
          <nav className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-fg">Site</span>
            {FOOTER_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted hover:text-fg">
                {item.label}
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

      {/* Every column is `auto` at `lg`, sized to its content, with the
          spare width shared between them by `justify-between`. Two of the
          columns are two-column grids, so an `fr` track for them would be
          `minmax(auto, 1fr)` and wrap "Screen with webcam" to three lines
          as soon as the others leaned on it. Below `lg` the three run over
          the container, so they wrap and the two-column grids keep their
          shape. Those inner grids are `auto` tracks too: with `1fr` they
          stretch to fill a wrapped column and the pairs drift apart.
          `content-start` is there because the outer grid stretches each
          column to the tallest, and a stretched grid shares that height among
          its rows — the free tools came out with half again the use cases'
          spacing. */}
      <Container className="grid grid-cols-1 gap-x-8 gap-y-10 border-t border-line py-12 sm:grid-cols-2 lg:grid-cols-[auto_auto_auto] lg:justify-between">
        {/* Every use-case page links to every other one through this column,
            which is what makes the set crawlable without a `/create` index.
            That is why it carries all of them rather than a curated few.

            The href is built here rather than stored on the registry entry:
            `Route` resolves its generic to `string`, and `string` does not
            extend the generated `/create/${SafeSlug<…>}`, so a field typed
            `Route` would reject every one of these. `Link` infers it from the
            literal instead — the same thing `blog/page.tsx` does. */}
        <nav className="grid grid-cols-[auto_auto] content-start justify-start gap-x-8 gap-y-3 text-sm">
          <Link href="/usecases" className="col-span-2 font-medium text-fg hover:text-muted">
            Use cases
          </Link>
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

        {/* `/compare` indexes these now, so this column is no longer the only
            path to them. It stays for the same reason the use cases do: a
            link from every page is what keeps pages this deep crawled, and
            one index page linked from the header is not that.

            Two columns, like the use cases, and for the sharper version of
            the same reason: there are twenty-six of these and a single run of
            them stood four times the height of the column beside it. */}
        <nav className="grid grid-cols-[auto_auto] content-start justify-start gap-x-8 gap-y-3 text-sm">
          <span className="col-span-2 font-medium text-fg">Alternatives</span>
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

        {/* The browser tools, linked from every page for the reason the use
            cases are: a set of pages that only the index links to is a set
            that gets crawled once. Two columns, as the use cases are: twelve
            links in one run is a column twice the height of everything
            beside it. */}
        <nav className="grid grid-cols-[auto_auto] content-start justify-start gap-x-8 gap-y-3 text-sm">
          <Link href="/free-tools" className="col-span-2 font-medium text-fg hover:text-muted">
            Free tools
          </Link>
          {freeTools.map((tool) => (
            <Link
              key={tool.slug}
              href={`/free-tools/${tool.slug}`}
              className="text-muted hover:text-fg"
            >
              {tool.navLabel}
            </Link>
          ))}
        </nav>
      </Container>

      <Container className="flex flex-col items-start gap-4 border-t border-line py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p>© {new Date().getFullYear()} Prequel. Made for macOS.</p>
        {/* The legal pages sit in the bottom bar rather than in a column above
            it, because that is where a reader who wants them already looks, and
            because the columns above are about what the product does. They are
            also what the transparency rules of a few places we post in ask to
            see, so they need to be reachable from every page rather than only
            from the one that links them. */}
        <nav className="flex items-center gap-5" aria-label="Legal">
          <Link href="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-fg">
            Terms
          </Link>
        </nav>
        <p className="font-mono tracking-wide">{SITE.platform}</p>
      </Container>
    </footer>
  );
}
