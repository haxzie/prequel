import type { Metadata } from "next";

import { Hero } from "@/components/landing/Hero";
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
      {/* The heading is the same sentence as `SITE.tagline`, but it is written
          out here rather than read from it. The tagline is what the site is
          called in a share card; this is the home page's headline. They agree
          today and are free to stop. */}
      <Hero
        title="Create cinematic screen recordings from Mac"
        lede="Record once. Prequel hands back a finished video — pushed in on the work, the camera framed, the dead air gone — and exports it at up to 4K."
      />
      <LandingBody faq={PRODUCT_FAQ} />
    </>
  );
}
