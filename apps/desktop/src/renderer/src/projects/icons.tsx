/**
 * The Projects grid's own glyphs.
 *
 * Only what the editor's set does not already have — the grid reuses
 * `FolderIcon` and `TrashIcon` from `editor/icons.tsx` rather than restating
 * them, so a change to either is a change in one place.
 *
 * Lucide's geometry, verbatim, for the same reason the editor's are: redrawing
 * a familiar icon by hand is how you end up with something that reads as
 * almost-right.
 */

/** Lucide's stroke geometry, restated so this file stands on its own. */
const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Lucide `pencil`. */
export function PencilIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}
