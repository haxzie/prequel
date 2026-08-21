import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AtAGlance,
  ComparisonHero,
  FeatureMatrix,
  PricingCompare,
} from "@/components/comparison/Comparison";
import { JsonLd } from "@/components/JsonLd";
import { LandingBody } from "@/components/landing/LandingBody";
import { Container } from "@/components/Section";
import { competitors, findCompetitor } from "@/content/competitors";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return competitors.map((competitor) => ({ slug: competitor.slug }));
}

// The registry is the complete set of pages, so anything else is a 404 rather
// than a render attempt that would fail on a missing module.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/alternatives/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const competitor = findCompetitor(slug);
  if (!competitor) return {};

  return pageMetadata({
    title: competitor.title,
    description: competitor.description,
    path: `/alternatives/${competitor.slug}`,
  });
}

export default async function AlternativePage({ params }: PageProps<"/alternatives/[slug]">) {
  const { slug } = await params;
  const competitor = findCompetitor(slug);
  if (!competitor) notFound();

  // The prefix has to stay a literal. The bundler turns this into a context
  // module over `src/content/alternatives`; a path assembled from a variable
  // compiles and then resolves to nothing at run time, for every slug at once.
  const { default: Body } = await import(`@/content/alternatives/${slug}.mdx`);

  return (
    <>
      <ComparisonHero competitor={competitor} />
      <AtAGlance competitor={competitor} />

      {/* The page's own prose, above the shared body. It is the only part that
          differs between these pages, so it goes where somebody who searched
          this phrase will actually read it. */}
      <section className="pb-16">
        <Container>
          {/* Element styling comes from src/mdx-components.tsx, which sets no
              measure of its own. This is the column the blog already uses. */}
          <div className="mx-auto max-w-2xl">
            <Body />
          </div>
        </Container>
      </section>

      <FeatureMatrix competitor={competitor} />
      <PricingCompare competitor={competitor} />

      {/* Unlike /create, the trail here is real and three deep, so it is worth
          emitting. The FAQPage schema comes off `LandingBody`'s own array. */}
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Alternatives", path: "/alternatives" },
          { name: competitor.title, path: `/alternatives/${competitor.slug}` },
        ])}
      />

      <LandingBody faq={competitor.faq} />
    </>
  );
}
