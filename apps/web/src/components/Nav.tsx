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
            the family stops at 400 — `next/font` rejects 500 and up outright
            rather than synthesising one — and negative tracking closes up joins a
            handwriting face needs.

            So the extra weight is a stroke on the glyphs rather than a heavier
            cut. `currentColor` so it inherits, and a fraction of a pixel because
            a handwriting face thickens fast: past about half a pixel the thin
            upstrokes stop being thin and the hand goes out of it. */}
        <Link
          href="/"
          className="font-script text-base text-fg [-webkit-text-stroke:0.4px_currentColor]"
          aria-label="Prequel home"
        >
          Prequel
        </Link>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              // White rather than muted, so the row reads as navigation rather
              // than as small print. The hover moves to a background instead of a
              // colour: there is nowhere brighter than `--fg` for the text to go,
              // and a link with no hover state at all reads as inert.
              className="rounded-full px-3 py-2 text-sm text-fg transition-colors hover:bg-white/8"
            >
              {item.label}
            </Link>
          ))}
          {/* Sign in sits with the nav links rather than beside the button,
              and stays visible at every width. It is not a call to action — it
              is how somebody who already has an account gets back to their
              library, and burying that behind a menu on a phone is how a
              returning user concludes there is no way back in. */}
          <Link
            href="/login"
            className="rounded-full px-3 py-2 text-sm text-fg transition-colors hover:bg-white/8"
          >
            Sign in
          </Link>

          {/* Dropped on the narrowest screens: the row cannot hold it, and the
              hero's own form is a scroll away rather than a navigation.

              The `hidden` sits on a wrapper because the button already carries
              `inline-flex`. Two unprefixed display utilities on one element is
              decided by Tailwind's emit order, not by the order they are
              written in, and `inline-flex` is the one that wins. */}
          <span className="ml-1.5 hidden sm:block">
            <ButtonLink href="/download" size="sm">
              Download
            </ButtonLink>
          </span>
        </nav>
      </Container>
    </header>
  );
}
