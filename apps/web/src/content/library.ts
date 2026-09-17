import { articles } from "./articles";
import { terms } from "./glossary";
import type { Topic } from "./topics";

/**
 * One card on `/content`, whichever registry it came from.
 *
 * Plain data on purpose. The gallery is a client component — it filters in the
 * browser — and everything handed to one crosses the server boundary as JSON.
 * A `Term` and an `Article` are already serialisable, but flattening them here
 * means the component never learns which registry a card came from beyond
 * `kind`, and a third kind of page is one more `case` below rather than a
 * change to the component's props.
 */
export type LibraryKind = "glossary" | "article";

export interface LibraryItem {
  kind: LibraryKind;
  slug: string;
  href: `/glossary/${string}` | `/articles/${string}`;
  title: string;
  summary: string;
  date: string;
  topics: Topic[];
}

/**
 * Articles first, newest at the top, then the glossary A to Z: each registry
 * keeps its own order, and the two are concatenated rather than merged into
 * one sort. Interleaving a dated article with an undated definition would
 * need a rule for which comes first, and there is no rule a reader would
 * predict.
 */
export function libraryItems(): LibraryItem[] {
  return [
    ...articles.map<LibraryItem>((article) => ({
      kind: "article",
      slug: article.slug,
      href: `/articles/${article.slug}`,
      title: article.title,
      summary: article.excerpt,
      date: article.date,
      topics: article.topics,
    })),
    ...terms.map<LibraryItem>((term) => ({
      kind: "glossary",
      slug: term.slug,
      href: `/glossary/${term.slug}`,
      title: term.title,
      summary: term.definition,
      date: term.date,
      topics: term.topics,
    })),
  ];
}
