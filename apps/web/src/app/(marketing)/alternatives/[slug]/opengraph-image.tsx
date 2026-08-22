import { ImageResponse } from "next/og";

import { competitors, findCompetitor } from "@/content/competitors";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";
import { SITE } from "@/lib/site";

// Static, because Next reads it at build time. Varying it per slug would need
// `generateImageMetadata`, and one site-wide alt is the right trade here.
export const alt = `Prequel — ${SITE.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return competitors.map((competitor) => ({ slug: competitor.slug }));
}

// In Next 16 `params` is a Promise here too — the synchronous form that worked
// in 15 is gone.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const competitor = findCompetitor(slug);

  return new ImageResponse(
    await ogCard({
      kicker: competitor ? `${competitor.name} alternative` : "Alternatives",
      title: competitor?.heading ?? SITE.tagline,
    }),
    size,
  );
}
