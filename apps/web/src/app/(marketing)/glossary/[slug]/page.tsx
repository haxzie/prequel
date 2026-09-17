import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { Container, Eyebrow } from "@/components/Section";
import { TryItAside } from "@/components/blog/TryItAside";
import { findTerm, relatedTerms, terms } from "@/content/glossary";
import { TOPICS } from "@/content/topics";
import { breadcrumbJsonLd, definedTermJsonLd, faqPageJsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return terms.map((term) => ({ slug: term.slug }));
}

// The registry is the complete set of terms, so anything else is a 404 rather
// than a render attempt that would fail on a missing module.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/glossary/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const term = findTerm(slug);
  if (!term) return {};

  return pageMetadata({
    // The question form, because that is what is typed into the search box.
    // The page's own heading is the bare term: a reader who is already here
    // does not need the question put back to them.
    title: `What is ${term.title.toLowerCase()}?`,
    description: term.definition,
    path: `/glossary/${term.slug}`,
    ownCard: true,
    openGraph: {
      type: "article",
      title: term.title,
      description: term.definition,
      publishedTime: term.date,
      url: `/glossary/${term.slug}`,
    },
  });
}

export default async function GlossaryTerm({ params }: PageProps<"/glossary/[slug]">) {
  const { slug } = await params;
  const term = findTerm(slug);
  if (!term) notFound();

  const { default: Body } = await import(`@/content/glossary/${slug}.mdx`);
  const related = relatedTerms(term.slug);

  return (
    <Container className="py-20">
      <article className="mx-auto max-w-2xl">
        {/* Back to the filtered gallery rather than the whole of it: the
            reader came from the list of terms, or would have. */}
        <Link href="/content?type=glossary" className="font-mono text-xs text-muted hover:text-fg">
          ← Glossary
        </Link>

        <header className="mt-8">
          <Eyebrow>Glossary</Eyebrow>
          <h1 className="text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
            {term.title}
          </h1>
          {/* The definition, at the size of a lede. It is the sentence the
              page exists for, so it comes before the heading is out of view
              and before any prose that qualifies it. */}
          <p className="mt-4 text-lg leading-relaxed text-pretty text-fg">{term.definition}</p>
          <p className="mt-5 flex flex-wrap gap-2 font-mono text-[11px] tracking-wide text-muted">
            {term.topics.map((topic) => (
              <Link
                key={topic}
                href={`/content?topic=${topic}`}
                className="rounded-full border border-line bg-elevated px-2.5 py-1 transition-colors hover:text-fg"
              >
                {TOPICS[topic]}
              </Link>
            ))}
          </p>
        </header>

        <hr className="my-10 border-line" />

        {/* Element styling comes from src/mdx-components.tsx, so the MDX itself
            stays free of class names. */}
        <Body />

        {related.length > 0 ? (
          <section className="mt-16">
            <h2 className="text-2xl font-medium tracking-tight text-fg">Related terms</h2>
            <ul className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
              {related.map((item) => (
                <li key={item.slug} className="bg-bg transition-colors hover:bg-surface">
                  <Link href={`/glossary/${item.slug}`} className="block px-6 py-5">
                    <span className="text-[0.9375rem] font-medium text-fg">{item.title}</span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-muted">
                      {item.definition}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Every term carries one, enforced by `faq` being required on `Term`.
            The questions are the ones a reader has once the definition has
            landed, which is why they sit after the body and not in it. */}
        <section className="mt-16">
          <h2 className="text-2xl font-medium tracking-tight text-fg">Questions people ask</h2>
          <dl className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {term.faq.map((item) => (
              <div key={item.question} className="bg-bg px-6 py-6">
                <dt className="text-[0.9375rem] font-medium text-fg">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Three blocks, matching the posts. `DefinedTerm` off the registry
            entry, the FAQ off `term.faq`, the same array the markup renders,
            and a two-hop trail to `/content`, which is a page that exists —
            `/glossary` on its own is a redirect, not a hop. */}
        <JsonLd data={definedTermJsonLd(term)} />
        <JsonLd data={faqPageJsonLd(term.faq)} />
        <JsonLd
          data={breadcrumbJsonLd([
            { name: "Content", path: "/content" },
            { name: term.title, path: `/glossary/${term.slug}` },
          ])}
        />

        <TryItAside />
      </article>
    </Container>
  );
}
