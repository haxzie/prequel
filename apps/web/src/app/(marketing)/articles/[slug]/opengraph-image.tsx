import { ImageResponse } from "next/og";

import { articles, findArticle } from "@/content/articles";
import { ogCard } from "@/lib/og";
import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/seo";

export const alt = "Prequel articles";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

// In Next 16 `params` is a Promise here too — the synchronous form that worked
// in 15 is gone.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = findArticle(slug);

  return new ImageResponse(
    await ogCard({ kicker: "Article", title: article?.title ?? "Prequel" }),
    size,
  );
}
