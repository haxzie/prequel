/**
 * The two cells a comparison table is made of.
 *
 * Lifted out of `pricing/page.tsx` when `/alternatives/<competitor>` needed the
 * same marks. Both tables read the same shapes, so a tick means one thing on
 * the whole site.
 */
export function Tick({ on }: { on: boolean }) {
  return on ? (
    <svg width="14" height="14" viewBox="0 0 14 14" className="text-fg" aria-hidden>
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
    // A rule rather than a cross. On a comparison page a red X reads as "fails"
    // when the honest meaning is "does not do this" — and overstating a
    // competitor's shortcomings is what makes the rest of the table doubted.
    <span className="block h-px w-3 bg-line" aria-hidden />
  );
}

export function Cell({ value }: { value: boolean | string }) {
  if (typeof value === "string") return <span className="text-fg">{value}</span>;
  return (
    <>
      <Tick on={value} />
      <span className="sr-only">{value ? "Included" : "Not included"}</span>
    </>
  );
}
