import Link from "next/link";

import { CONTACT_EMAIL, NAV, SITE } from "@/lib/site";

import { Logo } from "./Logo";
import { Container } from "./Section";
import { WaitlistForm } from "./WaitlistForm";

export function Footer() {
  return (
    <footer className="mt-32 border-t border-dashed border-rule">
      <Container className="grid gap-12 py-16 md:grid-cols-[1.4fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2.5" aria-label="Prequel home">
            <Logo size={32} />
            <span className="text-base font-medium tracking-tight text-fg">Prequel</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">{SITE.description}</p>
          <WaitlistForm className="mt-6 max-w-md" />
        </div>

        <div className="flex gap-16 md:justify-end">
          <nav className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-fg">Site</span>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted hover:text-fg">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-fg">Contact</span>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-muted hover:text-fg">
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </Container>

      <Container className="flex flex-col gap-2 border-t border-dashed border-rule py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Prequel. Made for macOS.</p>
        <p className="font-mono tracking-wide">{SITE.platform}</p>
      </Container>
    </footer>
  );
}
