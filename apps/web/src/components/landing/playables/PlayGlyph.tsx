/**
 * The play button on a row, and the stop it becomes.
 *
 * A triangle and a square drawn here rather than two imports: they are four
 * points and a rect, and `icons.tsx` is the site's icons rather than a place
 * to keep a shape used in one file.
 *
 * Not a `<button>` — every caller already wraps the whole row in one, and a
 * button inside a button is markup no browser agrees on. It carries the colour
 * so the row's own label can stay in the text colours the rest of the page
 * uses.
 */
export function PlayGlyph({ playing }: { playing: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-7 shrink-0 place-items-center rounded-full transition-colors ${
        playing ? "bg-accent text-white" : "bg-bg text-fg"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
        {playing ? (
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
        ) : (
          <path d="M8 5l11 7-11 7z" />
        )}
      </svg>
    </span>
  );
}
