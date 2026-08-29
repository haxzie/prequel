/**
 * The library sidebar's glyphs.
 *
 * Its own file rather than an addition to `editor/icons.tsx`, following what
 * the dock already does: each surface draws what it needs, so the editor's set
 * does not grow a section belonging to a screen it has nothing to do with.
 *
 * Sized by CSS rather than by props, like the other two files.
 */

/** Lucide's stroke geometry, restated here so this file stands alone. */
const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Lucide `settings-2`. Two sliders, rather than the gear everything uses. */
export function GeneralIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  );
}

/** Lucide `user`. */
export function AccountIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Lucide `arrow-up-right`.
 *
 * The mark for a row that leaves the app. It sits at the far end of its row
 * rather than beside the label, because it is not what the item *is* — it is
 * what pressing it does, which is hand you to the browser.
 */
export function ExternalIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}
