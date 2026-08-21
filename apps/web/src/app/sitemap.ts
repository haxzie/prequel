import type { MetadataRoute } from "next";

import { env } from "@prequel/env";

import { competitors } from "@/content/competitors";
import { posts } from "@/content/posts";
import { useCases } from "@/content/use-cases";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.5 },
    // No `lastModified`: the registry holds no date, and `new Date()` here
    // would tell crawlers every use-case page changed on every deploy, which is
    // how a site teaches Google to ignore the field. Posts pass `post.date`
    // below because they have a real one.
    ...useCases.map((useCase) => ({
      url: `${base}/create/${useCase.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...competitors.map((competitor) => ({
      url: `${base}/alternatives/${competitor.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: post.date,
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  ];
}
