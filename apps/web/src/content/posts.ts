/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to publish a post.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Write `src/content/blog/<slug>.mdx` — prose only, no frontmatter.
 *  2. Add an entry below whose `slug` is that filename.
 *
 *  Metadata lives here rather than in the MDX because `@next/mdx` does not read
 *  frontmatter, and the alternative — exporting it from each file and importing
 *  every file to build an index — pulls every post's body into the listing
 *  page's bundle.
 */

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO date. Sorted on, and rendered with `toLocaleDateString`. */
  date: string;
  tag: string;
  readingMinutes: number;
};

/** Newest first. `posts` below is sorted, so order here is not load-bearing. */
const ENTRIES: Post[] = [
  {
    slug: "four-files-not-one-video",
    title: "Four files and a manifest, not one video",
    excerpt:
      "Every other recorder burns the webcam into the screen while it captures. We write four files and a manifest instead, and it changes what the editor is allowed to do.",
    date: "2026-07-28",
    tag: "Architecture",
    readingMinutes: 6,
  },
  {
    slug: "driven-by-output-frames",
    title: "Why the export loop is driven by output frames",
    excerpt:
      "Ask what moment belongs in frame n, rather than asking what to do with the frame that just arrived. Cuts, mismatched frame rates and a camera that opened late all stop being special cases.",
    date: "2026-06-19",
    tag: "Rendering",
    readingMinutes: 7,
  },
  {
    slug: "geometry-is-computed-once",
    title: "Geometry is computed once",
    excerpt:
      "A preview and an export that disagree are only ever noticed after the file is written. The fix is boring: one module owns every position, and neither rasteriser is allowed to re-derive one.",
    date: "2026-05-30",
    tag: "Rendering",
    readingMinutes: 5,
  },
];

export const posts: Post[] = [...ENTRIES].sort((a, b) => b.date.localeCompare(a.date));

export function findPost(slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug);
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
