import { ImageResponse } from "next/og";

import { findFreeTool, freeTools } from "@/content/free-tools";
import { ogCard } from "@/lib/og";
import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/seo";
import { SITE } from "@/lib/site";

// Static, because Next reads it at build time. Varying it per slug would need
// `generateImageMetadata`, and one site-wide alt is the right trade here.
export const alt = `Prequel — ${SITE.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return freeTools.map((tool) => ({ slug: tool.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = findFreeTool(slug);

  return new ImageResponse(
    await ogCard({
      kicker: tool?.eyebrow ?? "Free browser tool",
      // The name and not the heading: a card is read in a feed next to a link,
      // where "Record your screen in the browser" says less about what is being
      // shared than "Free online screen recorder" does.
      title: tool?.name ?? SITE.tagline,
    }),
    size,
  );
}
