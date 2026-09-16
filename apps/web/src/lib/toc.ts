import { readFileSync } from "node:fs";
import { join } from "node:path";

import GithubSlugger from "github-slugger";

import type { DocSlug } from "@/content/docs";

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

/**
 * The raw Markdown of one docs page.
 *
 * Read off disk rather than out of the MDX module, because a compiled MDX file
 * is a React component and knows nothing of its own headings, and the plugins
 * that could have told it are callbacks — which Turbopack cannot be handed (see
 * `next.config.ts`). The file is the one place the headings can be read from.
 *
 * `process.cwd()` is `apps/web` under both `next dev` and `next build`: turbo
 * runs a filtered package in its own directory. Only ever runs at build time,
 * because every docs route is static.
 */
export function readDocSource(slug: DocSlug): string {
  return readFileSync(join(process.cwd(), "src/content/docs", `${slug}.mdx`), "utf8");
}

/**
 * The `##` and `###` headings of a Markdown source, with the ids `rehype-slug`
 * will have given them.
 *
 * `github-slugger` is the library `rehype-slug` uses, and a fresh instance per
 * document is what makes a repeated heading get the same `-1` suffix here that
 * it gets there. Fenced code is stripped first: a `## ` inside a listing is a
 * comment in some language, not a section.
 *
 * Inline markup is reduced to its text the way mdast's `toString` does, but
 * only for the three shapes that could plausibly appear; the docs keep their
 * headings plain (see the note in `content/docs.ts`), so this is a guard rather
 * than a parser.
 */
export function headingsOf(source: string): Heading[] {
  const slugger = new GithubSlugger();
  const withoutCode = source.replace(/^```[\s\S]*?^```\s*$/gm, "");
  const headings: Heading[] = [];

  for (const line of withoutCode.split("\n")) {
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match?.[1] || !match[2]) continue;

    const text = match[2]
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1")
      .trim();

    headings.push({ depth: match[1].length as 2 | 3, text, id: slugger.slug(text) });
  }

  return headings;
}
