import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Hero } from "@/components/landing/Hero";
import { LandingBody } from "@/components/landing/LandingBody";
import { Container } from "@/components/Section";
import { findUseCase, useCases } from "@/content/use-cases";
import { pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return useCases.map((useCase) => ({ slug: useCase.slug }));
}

// The registry is the complete set of pages, so anything else is a 404 rather
// than a render attempt that would fail on a missing module.
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/create/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) return {};

  return pageMetadata({
    title: useCase.title,
    description: useCase.description,
    path: `/create/${useCase.slug}`,
  });
}

export default async function UseCasePage({ params }: PageProps<"/create/[slug]">) {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) notFound();

  // The prefix has to stay a literal. The bundler turns this into a context
  // module over `src/content/create`; a path assembled from a variable compiles
  // and then resolves to nothing at run time, for every slug at once.
  const { default: Body } = await import(`@/content/create/${slug}.mdx`);

  return (
    <>
      <Hero eyebrow={useCase.eyebrow} title={useCase.heading} lede={useCase.lede} />

      {/* The page's own prose sits above the shared body. It is the only part
          that differs between these pages, so it goes where a visitor who
          searched for this phrase will read it — not under nine hundred words
          every other use-case page also carries. */}
      <section className="pb-16">
        <Container>
          {/* Element styling comes from src/mdx-components.tsx, which sets no
              measure of its own. This is the column the blog and the about page
              already use. */}
          <div className="mx-auto max-w-2xl">
            <Body />
          </div>
        </Container>
      </section>

      {/* This page's own questions, and only those. Appending the home page's
          list here is what made thirteen of every page's fifteen answers
          identical to the other fifteen pages'. */}
      <LandingBody faq={useCase.faq} />
    </>
  );
}
