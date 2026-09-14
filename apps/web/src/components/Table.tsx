/**
 * The two cells a comparison table is made of.
 *
 * Lifted out of `pricing/page.tsx` when `/alternatives/<competitor>` needed the
 * same marks. Both tables read the same shapes, so a tick means one thing on
 * the whole site.
 */
export function Tick({
  on,
  own = false,
}: {
  on: boolean;
  /**
   * Whether this is our own column. A tick there is drawn in `positive`, the
   * one green on the site, where a rival's is drawn in ink: the column the
   * reader is being asked to choose should read as the good news it is, and a
   * grid of identical ticks makes every column look like the same answer.
   * Asked for on 2026-09-14. The cross is the same red in either column, since
   * "does not do this" means the same thing whoever it is said about.
   */
  own?: boolean;
}) {
  return on ? (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      className={own ? "text-positive" : "text-fg"}
      aria-hidden
    >
      <path
        d="M2.5 7.5 5.5 10.5 11.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    // A red cross, the same weight and box as the tick so the two read as a
    // pair. This used to be a hairline rule, on the grounds that a cross reads
    // as "fails" where the honest meaning is "does not do this"; it was asked
    // for as a cross on 2026-09-14, because a rule on a grid of ticks reads as
    // a cell nobody filled in rather than as an answer.
    <svg width="14" height="14" viewBox="0 0 14 14" className="text-negative" aria-hidden>
      <path
        d="M3.5 3.5 10.5 10.5 M10.5 3.5 3.5 10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Cell({ value, own = false }: { value: boolean | string; own?: boolean }) {
  if (typeof value === "string") return <span className="text-fg">{value}</span>;
  return (
    <>
      <Tick on={value} own={own} />
      <span className="sr-only">{value ? "Included" : "Not included"}</span>
    </>
  );
}
