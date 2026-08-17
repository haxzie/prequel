import Link from "next/link";

import { NAV } from "@/lib/site";

import { ButtonLink } from "./Button";
import { Container } from "./Section";

export function Nav() {
  return (
    // Static and unstyled: it sits on the same measure as everything else, so
    // the page's rails are the only edges on screen. Nothing to stick, nothing
    // to blur, and no border of its own competing with them.
    <header>
      <Container className="flex h-20 items-center justify-between gap-4">
        {/* Playwrite VN, and only here. No weight or `tracking` utility on it:
            the family stops at 400 and asking for more gets a synthesised bold,
            and negative tracking closes up joins a handwriting face needs. */}
        <Link href="/" className="font-script text-base text-fg" aria-label="Prequel home">
          Prequel
        </Link>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
          {/* Dropped on the narrowest screens: the row cannot hold it, and the
              hero's own form is a scroll away rather than a navigation.

              The `hidden` sits on a wrapper because the button already carries
              `inline-flex`. Two unprefixed display utilities on one element is
              decided by Tailwind's emit order, not by the order they are
              written in, and `inline-flex` is the one that wins. */}
          <span className="ml-1.5 hidden sm:block">
            <ButtonLink href="/#waitlist" size="sm">
              Get early access
            </ButtonLink>
          </span>
        </nav>
      </Container>
    </header>
  );
}
