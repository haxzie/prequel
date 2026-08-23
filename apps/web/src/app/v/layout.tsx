import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { SITE } from "@/lib/site";

/**
 * A share link, opened by somebody who is not a customer.
 *
 * The most likely visitor has no account, has never heard of Prequel, and
 * clicked a link in a chat window to watch a two-minute recording. So there is
 * no site nav and no footer: a page of marketing wrapped around somebody else's
 * screen recording reads as an ad in front of the thing they actually wanted.
 *
 * A bar is worth the exception, though. Without one the page has no header at
 * all, which reads as an embed or a broken frame rather than as a page that
 * belongs somewhere — and the one question a stranger has is *what is this*.
 * Naming the product answers it in the place people look for the answer.
 *
 * In the layout rather than the page, so the deleted and not-found states are
 * dressed the same — see `v/not-found.tsx`, which exists precisely so a dead
 * link keeps this chrome instead of falling through to the marketing 404. A
 * link that no longer works is exactly when a visitor most needs to see whose
 * site they have landed on.
 */
export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
            aria-label={`${SITE.name} home`}
          >
            <Logo size={24} />
            {/* Playwrite VN, with a stroke rather than a heavier cut: the family
                stops at 400 and `next/font` refuses to synthesise one. Matches
                the marketing nav, which is the canonical treatment. */}
            <span className="font-script text-base text-fg [-webkit-text-stroke:0.4px_currentColor]">
              {SITE.name}
            </span>
          </Link>

          {/* The one piece of selling on the page, and it sits after the video
              in reading order rather than before it. "Made with" rather than
              "Try": the visitor is looking at evidence it works, and a claim is
              weaker than the thing they just watched. */}
          <Link
            href="/"
            className="hidden text-sm text-muted transition-colors hover:text-fg sm:block"
          >
            Made with {SITE.name}
          </Link>
        </div>
      </header>

      {children}
    </div>
  );
}
