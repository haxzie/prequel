import { ImageResponse } from "next/og";

import { findUseCase, useCases } from "@/content/use-cases";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";
import { SITE } from "@/lib/site";

// Static, because Next reads it at build time. Varying it per slug would need
// `generateImageMetadata`, and one site-wide alt is the right trade here.
export const alt = `Prequel — ${SITE.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return useCases.map((useCase) => ({ slug: useCase.slug }));
}

// In Next 16 `params` is a Promise here too — the synchronous form that worked
// in 15 is gone.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const useCase = findUseCase(slug);

  return new ImageResponse(
    await ogCard({
      // The card already uppercases and letterspaces the kicker, which is what
      // `<Eyebrow>` does in CSS on the page. Passing the eyebrow keeps the two
      // saying the same thing.
      kicker: useCase?.eyebrow ?? "macOS screen recorder",
      title: useCase?.heading ?? SITE.tagline,
    }),
    size,
  );
}
