import type { ReactNode } from "react";

import { Container } from "@/components/Section";

/**
 * One demo, drawn as a card on the page rather than as a band across it.
 *
 * The four demos used to be plain sections separated by 96px of air, which on
 * paper is nothing: a run of four animations with no edge between them reads
 * as one long scroll of moving pictures, and the only thing saying where one
 * argument ends and the next begins is whitespace that a phone eats anyway.
 * A card has an edge, so each demo is an object.
 *
 * The same object `BuiltForMac` draws at the end of the run — same radius,
 * same padding, same measure — in the page's grey instead of its gradient.
 * That one is the exception on purpose: it is the last of the five and the
 * only dark thing on the page, which is what makes it read as the end of the
 * sequence rather than a fifth demo.
 *
 * `py-5` and not the sections' old `py-24`: the padding that held the demos
 * apart now lives inside the card, and keeping both would stack 64px of inset
 * on 96px of gap and leave the cards adrift. What is left is the gap between
 * cards, and it is deliberately tight — a stack is what says they belong to
 * each other.
 */
export function DemoSection({ children }: { children: ReactNode }) {
  return (
    <section className="py-5">
      <Container>
        {/* `squircle` and `lit` for the reason every raised surface on this
            page carries them: the corner that continues into the straight edge
            rather than meeting it at a seam, and the one-pixel inner highlight
            along the top. `overflow-hidden` because the demos animate things
            that travel — a slice sliding in from the right would otherwise
            cross the card's edge and keep going. */}
        <div className="squircle lit overflow-hidden rounded-3xl border border-line bg-surface px-6 py-16 sm:px-12 lg:px-16 lg:py-20">
          {children}
        </div>
      </Container>
    </section>
  );
}
