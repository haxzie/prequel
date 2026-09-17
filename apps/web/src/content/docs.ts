import type { MDXComponents } from "mdx/types";
import type { JSX } from "react";

import type { FaqEntry } from "@/lib/faq";

/**
 * The documentation: how Prequel works, page by page.
 *
 * Each page is `content/docs/<slug>.mdx`, written as ordinary Markdown with two
 * exported strings and a short FAQ at the top:
 *
 *     export const title = "Permissions";
 *     export const description = "What macOS asks for, and what a missing grant costs.";
 *     export const faq = [{ question: "…", answer: "…" }];
 *
 * The FAQ is rendered under the body and emitted as `FAQPage` structured data
 * off the same array, the way the blog does it: an answer that differs between
 * the markup and the JSON-LD is the mismatch search engines penalise, and one
 * array cannot differ from itself. Three questions a reader of that page would
 * actually ask, answered in the page's own terms.
 *
 * The same arrangement the changelog uses, and for the same reason: the words
 * live beside the prose they describe, so renaming a page is one edit in one
 * file. `@next/mdx` does not read YAML front matter, so an export is the only
 * shape that reaches the page.
 *
 * What stays here is the order and the grouping, which a directory cannot give.
 * A section is a heading in the sidebar and nothing more: the URLs are flat,
 * `/docs/<slug>`, so moving a page between sections does not move its address.
 *
 * The body starts at `##`. The page draws the `h1` from `title`, and a second
 * `h1` inside the prose would be styled by nothing — `mdx-components.tsx` has
 * no override for it — and read by a crawler as a page with two names.
 *
 * Headings are plain text: no inline code, no links. Their ids are computed
 * twice, once by `rehype-slug` at compile time and once by `lib/toc.ts` for the
 * "On this page" list, and the two only agree when there is no inline markup
 * for them to reduce differently.
 *
 * `public/docs/` holds the screenshots and shares this route's prefix. There is
 * no clash: a static file is served first only when the path matches one, every
 * image has an extension, and no slug does.
 */
export const DOCS = [
  {
    id: "getting-started",
    title: "Getting started",
    pages: ["install", "permissions", "first-recording"],
  },
  {
    id: "recording",
    title: "Recording",
    pages: [
      "sources",
      "camera-and-microphone",
      "teleprompter",
      "shortcuts-and-countdown",
      "tray-menu",
    ],
  },
  {
    id: "editing",
    title: "Editing",
    pages: [
      "editor-overview",
      "frame-and-presets",
      "layout",
      "camera",
      "background",
      "recording-look",
      "zooms",
      "cursor",
      "timeline-and-cuts",
      "captions",
      "audio",
      "logo",
      "scene-presets",
    ],
  },
  {
    id: "export-and-share",
    title: "Export and share",
    pages: ["export", "share-links", "pricing-and-trial"],
  },
  {
    id: "reference",
    title: "Reference",
    pages: ["keyboard-shortcuts", "settings", "troubleshooting", "where-files-live"],
  },
] as const satisfies readonly { id: string; title: string; pages: readonly string[] }[];

export type DocSlug = (typeof DOCS)[number]["pages"][number];

/** A page as the sidebar, the pager and the index list it. */
export interface DocRef {
  slug: DocSlug;
  title: string;
  description: string;
  path: `/docs/${DocSlug}`;
}

export interface DocSection {
  id: string;
  title: string;
  pages: DocRef[];
}

/** A page with its body loaded, which is what the article route renders. */
export interface Doc extends DocRef {
  section: { id: string; title: string };
  faq: FaqEntry[];
  Body: (props: { components?: MDXComponents }) => JSX.Element;
}

const SLUGS: readonly DocSlug[] = DOCS.flatMap((section) => section.pages);

export function isDocSlug(value: string): value is DocSlug {
  return (SLUGS as readonly string[]).includes(value);
}

export function docPath(slug: DocSlug): `/docs/${DocSlug}` {
  return `/docs/${slug}`;
}

/**
 * The shape every `.mdx` under `content/docs` exports.
 *
 * Not validated at runtime: a page missing `title` fails the build with an
 * undefined heading, which is the loud failure wanted here. A `try` around the
 * import would ship a page with no name instead.
 */
type DocModule = {
  default: (props: { components?: MDXComponents }) => JSX.Element;
  title: string;
  description: string;
  faq: FaqEntry[];
};

/**
 * A template literal in the `import`, the way the blog and the changelog do it.
 * It is what lets a page be added by dropping a file in beside a slug — and
 * what fails the build when the file is missing, which is deliberate.
 */
async function load(slug: DocSlug): Promise<DocModule> {
  return (await import(`./docs/${slug}.mdx`)) as DocModule;
}

function sectionOf(slug: DocSlug) {
  const section = DOCS.find((candidate) => (candidate.pages as readonly string[]).includes(slug));
  // Unreachable for a `DocSlug`: the type is derived from the same array.
  if (!section) throw new Error(`No docs section lists ${slug}`);
  return { id: section.id, title: section.title };
}

async function ref(slug: DocSlug): Promise<DocRef> {
  const { title, description } = await load(slug);
  return { slug, title, description, path: docPath(slug) };
}

export async function loadDoc(slug: DocSlug): Promise<Doc> {
  const { default: Body, title, description, faq } = await load(slug);
  return { slug, title, description, path: docPath(slug), section: sectionOf(slug), faq, Body };
}

/**
 * Every section with every page's title, for the sidebar and the index.
 *
 * Imports every page to read two strings off each. The routes are fully
 * static, so this runs once per page at build time rather than per request —
 * the same cost `releases()` pays for the changelog.
 */
export async function outline(): Promise<DocSection[]> {
  return Promise.all(
    DOCS.map(async (section) => ({
      id: section.id,
      title: section.title,
      pages: await Promise.all(section.pages.map(ref)),
    })),
  );
}

/**
 * The pages either side of one, across section boundaries.
 *
 * Reading order is the flattened outline, so the last page of "Recording" leads
 * into the first of "Editing": a reader going through from the top should not
 * hit a dead end at every heading.
 */
export async function neighbours(slug: DocSlug): Promise<{ prev?: DocRef; next?: DocRef }> {
  const index = SLUGS.indexOf(slug);
  const prev = SLUGS[index - 1];
  const next = SLUGS[index + 1];
  return {
    ...(prev ? { prev: await ref(prev) } : {}),
    ...(next ? { next: await ref(next) } : {}),
  };
}
