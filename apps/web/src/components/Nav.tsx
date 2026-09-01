import Link from "next/link";

import { NAV } from "@/lib/site";

import { ButtonLink } from "./Button";
import { GitHubStars } from "./GitHubStars";
import { AppleIcon } from "./icons";
import { NavMenu } from "./NavMenu";
import { Container } from "./Section";

export function Nav() {
  return (
    // Static and unstyled: it sits on the same measure as everything else, so
    // the page's rails are the only edges on screen. Nothing to stick, nothing
    // to blur, and no border of its own competing with them.
    <header>
      <Container className="flex h-20 items-center justify-between gap-4">
        {/* The wordmark and the sections it leads into, as one cluster on the
            left rail, with the account and the download opposite. Splitting the
            row this way puts the sections next to the thing they belong to and
            leaves the right-hand end for the two things that are not sections
            at all.

            `gap-5` reads wider than it measures: the links carry `px-3`, so
            there is 32px of clear space between the wordmark and "Pricing".
            Tighter and the wordmark joins the row as a fourth link. */}
        <div className="flex items-center gap-5">
          {/* Playwrite VN, and only here. No weight or `tracking` utility on it:
              the family stops at 400 — `next/font` rejects 500 and up outright
              rather than synthesising one — and negative tracking closes up
              joins a handwriting face needs.

              So the extra weight is a stroke on the glyphs rather than a heavier
              cut. `currentColor` so it inherits, and a fraction of a pixel
              because a handwriting face thickens fast: past about half a pixel
              the thin upstrokes stop being thin and the hand goes out of it. */}
          <Link
            href="/"
            className="font-script text-base text-fg [-webkit-text-stroke:0.4px_currentColor]"
            aria-label="Prequel home"
          >
            Prequel
          </Link>

          {/* Gone below `sm`, where the row cannot hold it. The same links are
              in the menu at the other end of the header — see `NavMenu`. */}
          <nav className="hidden items-center gap-1 sm:flex">
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
          </nav>
        </div>

        {/* A plain `div` rather than a second `<nav>`. Two navigation landmarks
            in one header are announced as "navigation" twice with nothing to
            tell them apart, which is worse than one landmark and a group of
            controls beside it. */}
        <div className="flex items-center gap-1">
          {/* Sign in stays visible at every width, where the two beside it do
              not. It is not a call to action — it is how somebody who already
              has an account gets back to their library, and burying that behind
              a menu on a phone is how a returning user concludes there is no
              way back in. */}
          <Link
            href="/login"
            className="rounded-full px-3 py-2 text-sm text-fg transition-colors hover:bg-white/8"
          >
            Sign in
          </Link>

          {/* Both out of the row on the narrowest screens, and into the menu
              beside them rather than dropped: a header that keeps only a
              wordmark and a sign-in link has stopped being navigation.

              The `hidden` sits on a wrapper because the button already carries
              `inline-flex`. Two unprefixed display utilities on one element is
              decided by Tailwind's emit order, not by the order they are
              written in, and `inline-flex` is the one that wins.

              The repository sits before the button rather than after it. The
              download is what the page is asking for and belongs at the end of
              the row, where the eye finishes. */}
          <span className="hidden sm:block">
            <GitHubStars />
          </span>

          <span className="ml-1.5 hidden sm:block">
            <ButtonLink href="/download" size="sm">
              <AppleIcon className="-mt-0.5 size-4" />
              Download
            </ButtonLink>
          </span>

          {/* Rendered here and passed down, so the count is still fetched on
              the server — the note in `NavMenu` has the reason. */}
          <NavMenu stars={<GitHubStars />} />
        </div>
      </Container>
    </header>
  );
}
