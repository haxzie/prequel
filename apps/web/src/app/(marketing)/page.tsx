import type { Metadata } from "next";

import { Hero } from "@/components/landing/Hero";
import { HeroCard, HeroClip, HeroPlatform } from "@/components/landing/HeroWords";
import { AppPreview } from "@/components/landing/AppPreview";
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
      {/* The editor itself, under the hero. Here rather than inside
          `LandingBody` because that component is shared with all sixteen
          `/create/<slug>` pages, and the first thing under the headline should
          be the product rather than a feature's picture of it. */}
      {/* Wider than `Container`, which caps at `max-w-6xl` and is the measure
          the rest of the page is set to. Its own wrapper rather than a wider
          `max-w` passed down: both would be plain utilities of equal
          specificity, so which one won would come down to the order Tailwind
          emitted them in rather than the order they were written. The padding is
          `Container`'s, so the panel still lines up with the sections above and
          below it at the point where it stops growing. */}
      <section className="pb-8">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <AppPreview />
        </div>
      </section>

      <LandingBody faq={PRODUCT_FAQ} />
    </>
  );
}
