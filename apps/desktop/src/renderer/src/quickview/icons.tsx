/**
 * The three glyphs the quick view needs that the editor's set does not have.
 *
 * Everything else on the card — export, folder, copy, tick, spinner, close —
 * comes from `editor/icons.tsx` rather than being restated here, the same
 * arrangement the Projects grid has with that file.
 *
 * Lucide's geometry, verbatim. Redrawing a familiar icon by hand is how you
 * end up with something that reads as almost-right.
 */

/** Lucide's stroke geometry: everything they draw shares these. */
const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Lucide `square-pen`: open this in the editor. */
export function StudioIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  );
}

/**
 * Lucide `triangle-alert`: the export did not happen.
 *
 * Restated rather than taken from `dock/icons.tsx`, which has one: that set is
 * drawn on a 20px box with its own stroke weights, and a glyph from it beside
 * these would be a different hand at the same size.
 */
export function WarningIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Lucide `video` with a plus in it: record another take into this recording. */
export function AddClipIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M16 10.5V8a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5l6 4.5V6z" />
      <path d="M6 12h6M9 9v6" />
    </svg>
  );
}
