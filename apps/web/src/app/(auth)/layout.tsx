import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { Wash } from "@/components/Wash";
import { CONTACT_EMAIL, SITE } from "@/lib/site";

/**
 * Signing in, creating a team, accepting an invitation, connecting the app.
 *
 * One column, one thing to do, and nothing to click away to. The marketing nav
 * belongs to pages that are trying to interest somebody; every page in here is
 * for somebody who has already decided, and a "Get early access" button beside a
 * sign-in form is an invitation to abandon the thing they came to finish.
 *
 * The wash stays. It is the one piece of the site's identity that costs nothing
 * to keep — no links, no decisions — and without it these pages read as a
 * different product than the one that sent you here.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <Wash />

      <header className="flex items-center justify-center px-5 pt-10 sm:pt-14">
        {/* Home, and the only way out of the flow. Deliberately just the mark:
            a row of nav links here is the thing this layout exists to remove. */}
        <Link
          href="/"
          className="flex items-center gap-2.5 opacity-80 transition-opacity hover:opacity-100"
          aria-label={`${SITE.name} home`}
        >
          <Logo size={26} />
          <span className="font-script text-lg text-fg">{SITE.name}</span>
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center">{children}</main>

      {/* A footer that is one line, because a page with a single job should not
          end in four columns of links to other jobs. */}
      <footer className="px-5 pb-10 text-center text-xs text-muted">
        <Link href="/pricing" className="transition-colors hover:text-fg">
          Pricing
        </Link>
        <span className="px-2 opacity-40">·</span>
        <a href={`mailto:${CONTACT_EMAIL}`} className="transition-colors hover:text-fg">
          Need help?
        </a>
      </footer>
    </div>
  );
}
