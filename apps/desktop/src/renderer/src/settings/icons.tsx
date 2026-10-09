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

/**
 * The settings sidebar's own glyphs.
 *
 * Drawn a size down from the window's sidebar and listed here rather than
 * borrowed from `workspace/icons.tsx`: that file's `RecordingsIcon` means the
 * folder of takes, and the same glyph two columns apart meaning two things is
 * worse than no glyph at all.
 */

/** Lucide `video`. The act of recording, not the library of them. */
export function RecordingIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

/** Lucide `keyboard`. */
export function ShortcutsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
    </svg>
  );
}

/** Lucide `lock`. What macOS has allowed, in the shape macOS uses for it. */
export function PermissionsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/**
 * Lucide `app-window`. The application itself.
 *
 * Not `GeneralIcon`, which this row would otherwise share with the header a
 * few pixels above it. What the group holds is the app rather than a
 * recording — whether it opens at login, and which version it is.
 */
export function AppIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M10 4v4" />
      <path d="M2 8h20" />
      <path d="M6 4v4" />
    </svg>
  );
}
