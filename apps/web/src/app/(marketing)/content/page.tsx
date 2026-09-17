import type { Metadata } from "next";

import { ContentGallery } from "@/components/content/ContentGallery";
import { JsonLd } from "@/components/JsonLd";
import { Container, SectionHeading } from "@/components/Section";
import { libraryItems } from "@/content/library";
import { itemListJsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Content",
  description:
    "A glossary of screen recording terms and short articles on getting a better recording out of a Mac: frame rate, bitrate, system audio, captions and the rest.",
  path: "/content",
});

export default function Content() {
  const items = libraryItems();

  return (
    <Container className="py-20">
      <SectionHeading
        level={1}
        eyebrow="Content"
        title="Glossary and articles"
        lede="The words that come up when you record a screen, each defined on its own page, and the short pieces that did not belong on the blog. Filter by kind or by topic."
      />

      {/* No `Suspense`, and no `useSearchParams` inside: the note on
          `ContentGallery` says why. The cards are in the prerendered HTML and
          the filter is applied after hydration. */}
      <div className="mt-14">
        <ContentGallery items={items} />
      </div>

      {/* Every page the gallery can show, off the same array, so a card cannot
          be in the markup and missing from the structured data. An index emits
          a list and no breadcrumb, for the reason `blog/page.tsx` gives. */}
      <JsonLd data={itemListJsonLd(items.map((item) => ({ name: item.title, path: item.href })))} />
    </Container>
  );
}
