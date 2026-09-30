/**
 * The Exports pane's own glyphs.
 *
 * Only the two the rest of the app does not already have — the pane reuses
 * `ExportIcon`, `FolderIcon` and `CopyIcon` from `editor/icons.tsx` rather than
 * restating them, so a change to any of the three is a change in one place.
 *
 * Lucide's geometry, verbatim, for the reason `projects/icons.tsx` gives:
 * redrawing a familiar icon by hand is how you end up with something that reads
 * as almost-right.
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

/** Lucide `list`. */
export function ListIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13" />
    </svg>
  );
}

/** Lucide `layout-grid`. */
export function GridIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}
