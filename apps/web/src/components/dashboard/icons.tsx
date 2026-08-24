/**
 * The dashboard's icons.
 *
 * Lucide's geometry drawn inline rather than pulled from a package: there are a
 * handful of them and each is a path or two, so a dependency would cost more
 * than it saves. None of them set a size — the caller does that in CSS, which is
 * why the sidebar can draw them at 16px and a card at 14px without variants.
 */
export const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Lucide `arrow-left`, for going back up to the list. */
export function BackIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

/** Lucide `pencil`, for editing the thing it sits beside. */
export function PencilIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

/** Lucide `trash-2`. */
export function TrashIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

/**
 * Lucide `more-vertical`. The three dots that mean "and the rest".
 *
 * Filled rather than stroked: at the size this is drawn a one-unit ring reads as
 * a smudge, and three smudges do not read as a menu.
 */
export function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}
