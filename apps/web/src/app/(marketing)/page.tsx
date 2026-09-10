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
        lede="Record on macOS and get an auto-edited video with smart zooms, a framed camera and a polished background, ready to fine-tune."
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
      {/* Hidden below `md`. The panel is a macOS window with a title bar, a
          dock, an inspector and a timeline in it, and at 390px what is left
          after the squeeze is not a smaller picture of the product but an
          unreadable one. The hero and the demos under it carry the page on a
          phone.

          `AppPreview`'s `ON_SCREEN` is this same breakpoint, and it is what
          keeps the two videos off a phone's connection: hiding the panel stops
          the paint and nothing else. Change one and change the other. */}
      <section className="hidden pb-8 md:block">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <AppPreview />
        </div>
      </section>

      <LandingBody faq={PRODUCT_FAQ} />
    </>
  );
}
