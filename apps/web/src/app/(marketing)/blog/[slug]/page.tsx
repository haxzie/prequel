import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { Container } from "@/components/Section";
import { Byline } from "@/components/blog/Byline";
import { TryItAside } from "@/components/blog/TryItAside";
import { clusterOf, findPost, formatDate, posts } from "@/content/posts";
import { blogPostingJsonLd, breadcrumbJsonLd, faqPageJsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

// The registry is the complete set of posts, so anything else is a 404 rather
// than a render attempt that would fail on a missing module.
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) return {};

  return pageMetadata({
    title: post.title,
    description: post.excerpt,
    path: `/blog/${post.slug}`,
    ownCard: true,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
      url: `/blog/${post.slug}`,
    },
  });
}

export default async function BlogPost({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) notFound();

  const { default: Body } = await import(`@/content/blog/${slug}.mdx`);

  // Both sides of the cluster come off `pillar`, so a post cannot claim a
  // parent that does not list it back.
  const parent = post.pillar ? findPost(post.pillar) : undefined;
  const cluster = clusterOf(post.slug);

  return (
    <Container className="py-20">
      <article className="mx-auto max-w-2xl">
        <Link href="/blog" className="font-mono text-xs text-muted hover:text-fg">
          ← All posts
        </Link>

        <header className="mt-8">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-wide text-muted">
            <span className="rounded-full border border-line bg-elevated px-2.5 py-1">
              {post.tag}
            </span>
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span aria-hidden>·</span>
            <span>{post.readingMinutes} min read</span>
          </div>
          <h1 className="mt-4 text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
            {post.title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-pretty text-muted">{post.excerpt}</p>

          {/* Under the excerpt rather than in the meta row: the note in
              `Byline.tsx` says why. */}
          <Byline />

          {/* Up to the pillar. Inside the header rather than after the body,
              because a reader who arrived from a narrow search may want the
              broad guide instead, and that is a decision made before reading.
              Comes off `post.pillar`, the same field that builds the list of
              posts on the pillar itself, so the two cannot disagree. */}
          {parent ? (
            <p className="mt-6 text-sm text-muted">
              Part of{" "}
              <Link
                href={`/blog/${parent.slug}`}
                className="text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-accent"
              >
                {parent.title}
              </Link>
            </p>
          ) : null}
        </header>

        <hr className="my-10 border-line" />

        {/* Element styling comes from src/mdx-components.tsx, so the MDX itself
            stays free of class names. */}
        <Body />

        {/* The other half of `pillar`: everything filed under this page. Only
            renders on a pillar, since an ordinary post has an empty cluster. */}
        {cluster.length > 0 ? (
          <section className="mt-16">
            <h2 className="text-2xl font-medium tracking-tight text-fg">Read next</h2>
            <ul className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
              {cluster.map((item) => (
                <li key={item.slug} className="bg-bg transition-colors hover:bg-surface">
                  <Link href={`/blog/${item.slug}`} className="block px-6 py-5">
                    <span className="text-[0.9375rem] font-medium text-fg">{item.title}</span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-muted">
                      {item.excerpt}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Every post carries one, enforced by `faq` being required on `Post`.
            It sits after the body because it answers what is left over, not
            what the post is about, and a reader who got their answer in the
            prose should never have to scroll past it. */}
        <section className="mt-16">
          <h2 className="text-2xl font-medium tracking-tight text-fg">
            Frequently asked questions
          </h2>
          <dl className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {post.faq.map((item) => (
              <div key={item.question} className="bg-bg px-6 py-6">
                <dt className="text-[0.9375rem] font-medium text-fg">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Three separate blocks rather than one `@graph`, matching the rest of
            the site. The FAQ data comes off `post.faq`, the same array the
            markup above renders, so the two cannot drift apart. */}
        <JsonLd data={blogPostingJsonLd(post)} />
        <JsonLd data={faqPageJsonLd(post.faq)} />
        <JsonLd
          data={breadcrumbJsonLd([
            { name: "Blog", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ])}
        />

        <TryItAside />
      </article>
    </Container>
  );
}
