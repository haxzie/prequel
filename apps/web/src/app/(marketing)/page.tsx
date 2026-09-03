import type { Metadata } from "next";

import { Hero } from "@/components/landing/Hero";
import { HeroCard, HeroClip, HeroPlatform } from "@/components/landing/HeroWords";
import { LandingBody } from "@/components/landing/LandingBody";
import { PRODUCT_FAQ } from "@/lib/faq";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  path: "/",
  description: SITE.description,
});

export default function Home() {
  return (
    <>
      {/* The heading and `SITE.tagline` no longer say the same thing, and that
          is the point of writing it out here. The tagline is what a share card
          and the `<title>` call the site; this is the headline, and it names
          the thing people actually search for — a screen recorder for Mac —
          with three of its words drawn as chips a share card has nowhere to
          put. */}
      <Hero
        title={
          <>
            The <HeroCard>cinematic</HeroCard> <HeroClip>screen recorder</HeroClip> for{" "}
            <HeroPlatform>Mac</HeroPlatform>
          </>
        }
        lede="Record once. Prequel hands back a finished video: pushed in on the work, the camera framed, a background behind it. It exports at up to 4K."
      />
      <LandingBody faq={PRODUCT_FAQ} />
    </>
  );
}
