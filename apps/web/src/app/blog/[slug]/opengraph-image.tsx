import { ImageResponse } from "next/og";

import { findPost, posts } from "@/content/posts";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const alt = "Prequel blog";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

// In Next 16 `params` is a Promise here too — the synchronous form that worked
// in 15 is gone.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = findPost(slug);

  return new ImageResponse(
    await ogCard({ kicker: post?.tag ?? "Blog", title: post?.title ?? "Prequel" }),
    size,
  );
}
