/**
 * The sidebar's glyphs.
 *
 * Its own file rather than an addition to `editor/icons.tsx`, following what
 * the dock already does: each surface draws what it needs, so the editor's set
 * does not grow a section belonging to a window it has nothing to do with.
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

/**
 * The record glyph: a ring with a filled centre.
 *
 * Drawn rather than taken from Lucide, whose `circle-dot` puts a one-unit dot
 * in the middle that disappears at sidebar size. This is the symbol every
 * recorder uses, and it has to read at 16px.
 */
export function RecordingIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Lucide `keyboard`. */
export function ShortcutsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M18 8h.01" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
      <path d="M7 16h10" />
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
