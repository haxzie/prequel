import type { Heading } from "@/lib/toc";

/**
 * The headings of the open page, as anchors.
 *
 * Plain anchors with no scroll-spy. Highlighting the heading in view needs an
 * `IntersectionObserver` in a client component, and the value of that on a
 * page of this length is a moving dot. The `id`s come from `rehype-slug` and
 * the list from `lib/toc.ts`, both off the same text.
 */
export function DocsToc({ headings }: { headings: Heading[] }) {
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 font-mono text-xs tracking-[0.18em] text-muted uppercase">On this page</p>
      <ul className="flex flex-col gap-1.5 border-l border-line">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              // A hairline rail with the depth shown as indent: the classic
              // shape, and the one that survives a long `###` without wrapping
              // into the article.
              className={`-ml-px block border-l border-transparent py-0.5 pl-3 leading-snug text-muted transition-colors hover:border-fg hover:text-fg ${
                heading.depth === 3 ? "pl-6" : ""
              }`}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
