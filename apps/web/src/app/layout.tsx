import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader, Playwrite_VN } from "next/font/google";
import type { ReactNode } from "react";

import { env } from "@prequel/env";

import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { Nav } from "@/components/Nav";
import { Wash } from "@/components/Wash";
import { Rails } from "@/components/Rails";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo";
import { SITE } from "@/lib/site";

import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

// One word in the headline, and nothing else on the site.
//
// Newsreader rather than a display serif like Instrument Serif, which ships a
// 400 weight and nothing else: asking for bold there gets a synthesised smear
// instead of a drawn face. 600 is a real cut, and the italic is a true italic
// rather than a slanted roman.
const serif = Newsreader({
  subsets: ["latin"],
  weight: "600",
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

// The wordmark, and nothing else.
//
// No `subsets` and no `preload` — Playwrite VN declares no subsets, so Next's
// generated types omit both and it is never preloaded. Passing either is a
// typecheck error rather than a runtime surprise, which is the good outcome.
//
// The family also tops out at 400 and has no italic, so the wordmark must not
// ask for either: both would be synthesised.
const script = Playwrite_VN({
  weight: "400",
  variable: "--font-playwrite",
  display: "swap",
});

export const metadata: Metadata = {
  // Without this, any relative URL in metadata — the OG image included — is a
  // build error rather than a warning.
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: ["screen recorder", "macOS", "screen recording", "video editor", "screen capture"],
  // Per-page metadata sets `openGraph.url` and `alternates.canonical`. A home
  // URL here would leak into every subpage's share cards.
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: { card: "summary_large_image" },
};

// `themeColor` and `colorScheme` inside `metadata` are deprecated — they belong
// to this export.
export const viewport: Viewport = { themeColor: "#0b0d11", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Next 16 stopped overriding scroll behaviour during navigation, so the
    // stylesheet's `scroll-behavior: smooth` needs this attribute to apply to
    // in-page anchors as well as reloads.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${sans.variable} ${mono.variable} ${serif.variable} ${script.variable}`}
    >
      <body>
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
        <Wash />
        <Rails />
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
