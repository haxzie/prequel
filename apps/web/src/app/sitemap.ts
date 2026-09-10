import type { MetadataRoute } from "next";

import { env } from "@prequel/env";

import { latestDate } from "@/content/changelog";
import { competitors } from "@/content/competitors";
import { posts } from "@/content/posts";
import { useCases } from "@/content/use-cases";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/features`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    // No `lastModified`, for the reason spelled out on the use-case pages below:
    // this index holds no date of its own, and `new Date()` would claim it
    // changed on every deploy.
    { url: `${base}/usecases`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/blog`, changeFrequency: "weekly", priority: 0.8 },
    // The date of the newest release, which is the only thing on the page that
    // ever moves. It has a real one, so it can say so.
    {
      url: `${base}/changelog`,
      lastModified: await latestDate(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/support`, changeFrequency: "yearly", priority: 0.5 },
    // Crawlable, and deliberately not `noindex`: a policy nobody outside can
    // read is not transparency. Low priority because nobody should arrive here
    // from a search for a screen recorder.
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
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
