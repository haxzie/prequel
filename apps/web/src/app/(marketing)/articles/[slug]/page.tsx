import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { Container } from "@/components/Section";
import { Byline } from "@/components/blog/Byline";
import { TryItAside } from "@/components/blog/TryItAside";
import { articles, findArticle } from "@/content/articles";
import { formatDate } from "@/content/posts";
import { TOPICS } from "@/content/topics";
import { articleJsonLd, breadcrumbJsonLd, faqPageJsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

// The registry is the complete set of articles, so anything else is a 404
// rather than a render attempt that would fail on a missing module.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/articles/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) return {};

  return pageMetadata({
    title: article.title,
    description: article.excerpt,
    path: `/articles/${article.slug}`,
    ownCard: true,
    openGraph: {
      type: "article",
      title: article.title,
      description: article.excerpt,
      publishedTime: article.date,
      url: `/articles/${article.slug}`,
    },
  });
}

/**
 * The same page as a blog post, without the pillar. The header, the byline,
 * the FAQ and the panel at the foot are the post's; what differs is the
 * trail back, which goes to `/content` rather than `/blog`, and the tag,
 * which is the article's topics rather than a kind.
 */
export default async function ArticlePage({ params }: PageProps<"/articles/[slug]">) {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) notFound();

  const { default: Body } = await import(`@/content/articles/${slug}.mdx`);

  return (
    <Container className="py-20">
      <article className="mx-auto max-w-2xl">
        <Link href="/content?type=article" className="font-mono text-xs text-muted hover:text-fg">
          ← Articles
        </Link>

        <header className="mt-8">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-wide text-muted">
            {article.topics.map((topic) => (
              <Link
                key={topic}
                href={`/content?topic=${topic}`}
                className="rounded-full border border-line bg-elevated px-2.5 py-1 transition-colors hover:text-fg"
              >
                {TOPICS[topic]}
              </Link>
            ))}
            <time dateTime={article.date}>{formatDate(article.date)}</time>
            <span aria-hidden>·</span>
            <span>{article.readingMinutes} min read</span>
          </div>
          <h1 className="mt-4 text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
            {article.title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-pretty text-muted">{article.excerpt}</p>
          <Byline />
        </header>

        <hr className="my-10 border-line" />

        {/* Element styling comes from src/mdx-components.tsx, so the MDX itself
            stays free of class names. */}
        <Body />

        {/* Every article carries one, enforced by `faq` being required on
            `Article`, and it sits after the body for the reason a post's does:
            it answers what is left over. */}
        <section className="mt-16">
          <h2 className="text-2xl font-medium tracking-tight text-fg">
            Frequently asked questions
          </h2>
          <dl className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {article.faq.map((item) => (
              <div key={item.question} className="bg-bg px-6 py-6">
                <dt className="text-[0.9375rem] font-medium text-fg">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Three blocks, matching the posts. The FAQ data comes off
            `article.faq`, the same array the markup above renders. */}
        <JsonLd data={articleJsonLd(article)} />
        <JsonLd data={faqPageJsonLd(article.faq)} />
        <JsonLd
          data={breadcrumbJsonLd([
            { name: "Content", path: "/content" },
            { name: article.title, path: `/articles/${article.slug}` },
          ])}
        />

        <TryItAside />
      </article>
    </Container>
  );
}
