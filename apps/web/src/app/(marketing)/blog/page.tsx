import type { Metadata } from "next";
import Link from "next/link";

import { Container, SectionHeading } from "@/components/Section";
import { formatDate, posts } from "@/content/posts";
import { JsonLd } from "@/components/JsonLd";
import { blogJsonLd, breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Blog",
  description:
    "Comparisons, buying guides and how to get a better screen recording out of your Mac.",
  path: "/blog",
});

export default function BlogIndex() {
  return (
    <Container className="py-20">
      <SectionHeading
        eyebrow="Blog"
        title="Guides and comparisons"
        lede="What the tools in this category actually do, what they cost, and how to get a recording worth sending out of your Mac."
      />

      <ul className="mt-14 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
        {posts.map((post) => (
          <li key={post.slug} className="bg-bg transition-colors hover:bg-surface">
            <Link href={`/blog/${post.slug}`} className="block px-6 py-7 sm:px-8">
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-wide text-muted">
                <span className="rounded-full border border-line bg-elevated px-2.5 py-1">
                  {post.tag}
                </span>
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <span aria-hidden>·</span>
                <span>{post.readingMinutes} min read</span>
              </div>
              <h2 className="mt-3 text-xl font-medium tracking-tight text-balance text-fg">
                {post.title}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-pretty text-muted">
                {post.excerpt}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {/* Off the same `posts` array the list above renders, so a post can never
          be in the markup and missing from the structured data. */}
      <JsonLd data={blogJsonLd(posts)} />
      <JsonLd data={breadcrumbJsonLd([{ name: "Blog", path: "/blog" }])} />
    </Container>
  );
}
