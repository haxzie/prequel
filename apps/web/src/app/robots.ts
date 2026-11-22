import type { MetadataRoute } from "next";

import { env } from "@prequel/env";

// The answer engines are each named explicitly rather than left to `*`, because
// a few of them read a wildcard group as "no rule for me" and skip the site —
// and because one of these appearing in a future blanket disallow should be a
// deliberate edit, not a side effect. Separated by job: GPTBot and ClaudeBot
// train, OAI-SearchBot and friends build the index behind an answer,
// ChatGPT-User and Claude-User fetch a page a person just asked about.
const ENGINE_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "DuckAssistBot",
  "meta-externalagent",
  "MistralAI-User",
  "YouBot",
];

export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      {
        userAgent: ENGINE_CRAWLERS,
        allow: "/",
        disallow: "/api/",
        // Not a standard directive, and nothing is documented as reading it.
        // It sits in this group rather than beside `Sitemap:` because that is
        // where the type allows a non-standard one, and because the hint is
        // for these agents rather than for every crawler there is. A parser
        // that does not know it ignores the line.
        other: { LLMs: `${base}/llms.txt` },
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
