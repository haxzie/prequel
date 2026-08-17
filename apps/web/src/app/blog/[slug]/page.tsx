import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/Section";
import { WaitlistForm } from "@/components/WaitlistForm";
import { findPost, formatDate, posts } from "@/content/posts";

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

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
      url: `/blog/${post.slug}`,
    },
  };
}

export default async function BlogPost({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) notFound();

  const { default: Body } = await import(`@/content/blog/${slug}.mdx`);

  return (
    <Container className="py-20">
      <article className="mx-auto max-w-2xl">
        <Link href="/blog" className="font-mono text-xs text-muted hover:text-fg">
          ← All posts
        </Link>

        <header className="mt-8">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-wide text-muted">
            <span className="rounded-full border border-line px-2.5 py-1">{post.tag}</span>
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span aria-hidden>·</span>
            <span>{post.readingMinutes} min read</span>
          </div>
          <h1 className="mt-4 text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
            {post.title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-pretty text-muted">{post.excerpt}</p>
        </header>

        <hr className="my-10 border-line" />

        {/* Element styling comes from src/mdx-components.tsx, so the MDX itself
            stays free of class names. */}
        <Body />

        <aside className="mt-16 rounded-2xl border border-line bg-surface p-7">
          <h2 className="text-base font-medium text-fg">Prequel is in development</h2>
          <p className="mt-2 text-sm text-muted">
            Leave an address and we&rsquo;ll send the first build when it is worth installing.
          </p>
          <WaitlistForm className="mt-5" />
        </aside>
      </article>
    </Container>
  );
}
