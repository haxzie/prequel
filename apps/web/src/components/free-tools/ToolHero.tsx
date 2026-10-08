import type { ReactNode } from "react";

import { Container, Eyebrow } from "@/components/Section";

/**
 * The block above a tool.
 *
 * Deliberately not `landing/Hero`. That one opens with the app mark, a stack of
 * faces and a download button, which is the right shape for a page whose ask is
 * "get the app" and the wrong one here: the ask on these pages is the thing
 * directly below this block, and anything standing between a visitor and it is
 * in the way. A heading, two sentences, and three facts that answer the only
 * question a free tool raises.
 */
export function ToolHero({
  eyebrow,
  title,
  lede,
  facts,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  facts: string[];
}): ReactNode {
  return (
    <section className="pt-14 pb-8 sm:pt-20">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="text-3xl font-medium tracking-tight text-balance text-fg sm:text-5xl">
            {title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-muted">
            {lede}
          </p>
          {/* Pills rather than a sentence. These are the three things somebody
              checks before they trust a free tool with their screen, and a
              reader scanning for them should not have to read a paragraph to
              find out which ones are true. */}
          <ul className="mt-7 flex flex-wrap justify-center gap-2">
            {facts.map((fact) => (
              <li
                key={fact}
                className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs text-muted"
              >
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
