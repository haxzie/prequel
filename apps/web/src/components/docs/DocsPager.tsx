import Link from "next/link";

import type { DocRef } from "@/content/docs";

/**
 * Previous and next, at the foot of a page.
 *
 * Two cards rather than two text links: on the last page of a section the
 * next card is the first page of the next section, and a bare title there
 * ("Editor overview", after "Tray menu") reads as a non sequitur without the
 * small label above it saying which way it goes.
 */
export function DocsPager({ prev, next }: { prev?: DocRef; next?: DocRef }) {
  if (!prev && !next) return null;

  return (
    <nav aria-label="Pages" className="mt-16 grid gap-3 sm:grid-cols-2">
      {prev ? <Card doc={prev} direction="Previous" /> : <span aria-hidden />}
      {next ? <Card doc={next} direction="Next" align="right" /> : null}
    </nav>
  );
}

function Card({
  doc,
  direction,
  align = "left",
}: {
  doc: DocRef;
  direction: "Previous" | "Next";
  align?: "left" | "right";
}) {
  return (
    <Link
      href={doc.path}
      className={`block rounded-2xl border border-line bg-bg px-5 py-4 transition-colors hover:bg-surface ${
        align === "right" ? "text-right" : ""
      }`}
    >
      <span className="font-mono text-[11px] tracking-wide text-muted">{direction}</span>
      <span className="mt-1 block text-[0.9375rem] font-medium text-fg">{doc.title}</span>
    </Link>
  );
}
