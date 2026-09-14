import type { ReactNode } from "react";

/**
 * One card on `/features`: a picture, an outcome, and how.
 *
 * `span` is what makes the grid a bento rather than a table. A `wide` card
 * takes two columns, which is where a timeline or a picker with fourteen cells
 * goes; a `tall` one takes two rows, which is where a panel of controls or six
 * lines of caption goes. The rest are one cell. A section chooses its spans so
 * the cards fill their rows — see `Bento` below for why that has to be checked
 * by hand.
 */
export interface Card {
  title: string;
  body: string;
  visual: ReactNode;
  span?: "wide" | "tall";
}

/**
 * A section's cards, in a three-column grid with spans.
 *
 * Gapped cards rather than the hairline grid the home page's editor cards use.
 * That grid paints its lines by letting the parent show through the gaps,
 * which means it also shows through any cell nothing landed in — and with
 * spans in play a cell nothing landed in is a real possibility. Gaps make an
 * empty cell read as air rather than as a card that failed to render.
 *
 * `grid-flow-dense` lets a one-cell card that comes after a wide one back-fill
 * the hole the wide one left, so the source order can put the wide card first
 * without the grid reading top-to-bottom as wide, hole, card. It only fills
 * holes with cards that fit, so a section still has to add up to full rows of
 * three. Every set on the page does: six cards as a wide, a tall and four
 * singles, or as three wides zigzagged with three singles.
 *
 * Both spans apply at `lg` only. At `sm` the grid is two columns and every
 * card is one cell: a wide card there is a full row, so three of them in a set
 * of six put nine cells into a two-column grid and leave a hole at the end,
 * and a tall card beside a stack of singles leaves one dense flow cannot
 * always fill. Six singles in two columns is three full rows. The pictures
 * are drawn for a single cell first and widen at `lg`, which is why their
 * breakpoint classes are `lg:` and not `sm:`.
 */
export function Bento({ cards }: { cards: Card[] }) {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-flow-dense lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.title}
          className={`flex flex-col overflow-hidden rounded-2xl border border-line bg-bg ${
            card.span === "wide" ? "lg:col-span-2" : card.span === "tall" ? "lg:row-span-2" : ""
          }`}
        >
          <div aria-hidden className="contents">
            {card.visual}
          </div>
          <div className="flex flex-col gap-2.5 p-6">
            <h3 className="text-[0.9375rem] font-medium text-fg">{card.title}</h3>
            <p className="text-sm leading-relaxed text-muted">{card.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
