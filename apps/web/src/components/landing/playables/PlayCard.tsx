import type { ReactNode } from "react";

/**
 * One card in the pair.
 *
 * `h-full` and a column, so two cards side by side come out the same height
 * whatever is in them. The words take the slack — `flex-1` on the block under
 * the stage — rather than the stage stretching: a demo given a hundred spare
 * pixels has to decide what to do with them, and a paragraph simply sits at
 * the top of a taller box.
 *
 * The picture comes first and the words under it, the way the step cards near
 * the top of the page are built — the thing to try should be the thing the
 * card opens on.
 */
export function PlayCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="squircle lit flex h-full w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface">
      {children}
      <div className="flex-1 px-7 pt-6 pb-7">
        <h3 className="text-[0.9375rem] font-medium text-fg">{title}</h3>
        <p className="mt-2.5 text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}

/**
 * The lid each card's demo sits on.
 *
 * A step darker than the card, so the thing you press is plainly a surface and
 * not the page. Bordered along the bottom only — the card's own edge draws the
 * other three, and a full border inside a card is a box in a box.
 */
export function Stage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative border-b border-line bg-elevated ${className}`}>{children}</div>;
}
