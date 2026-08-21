import type { Metadata } from "next";
import Link from "next/link";

import { Container, SectionHeading } from "@/components/Section";
import { formatDate, posts } from "@/content/posts";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Blog",
  description:
    "How Prequel is built — capture, rendering and the decisions that only look obvious afterwards.",
  path: "/blog",
});

export default function BlogIndex() {
  return (
    <Container className="py-20">
      <SectionHeading
        eyebrow="Blog"
        title="Notes from building Prequel"
        lede="Capture, rendering, and the decisions that only look obvious once something has already gone wrong."
      />

      <ul className="mt-14 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
        {posts.map((post) => (
          <li key={post.slug} className="bg-bg transition-colors hover:bg-surface">
            <Link href={`/blog/${post.slug}`} className="block px-6 py-7 sm:px-8">
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-wide text-muted">
                <span className="rounded-full border border-line px-2.5 py-1">{post.tag}</span>
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
    </Container>
  );
}
