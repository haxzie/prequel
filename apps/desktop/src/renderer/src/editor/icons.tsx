/**
 * The editor's glyphs.
 *
 * Sized by CSS rather than by props, like `dock/icons.tsx` — the same icon
 * appears at 14px in the transport and 18px in the inspector, and a size prop
 * would put that decision in the wrong place.
 *
 * The three tool icons are Lucide's geometry (ISC licensed), inlined rather
 * than pulled in as a package: this repo already draws its icons this way in
 * two files, and one dependency for three glyphs would leave two systems to
 * keep in step. Their paths are verbatim — redrawing a familiar icon by hand is
 * how you end up with something that reads as almost-right.
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

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
    </svg>
  );
}

export function SkipStartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h2.5v14H6zm12 0v14l-9-7z" />
    </svg>
  );
}

export function SkipEndIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15.5 5H18v14h-2.5zM6 5l9 7-9 7z" />
    </svg>
  );
}

/** Lucide `trash-2`. */
export function TrashIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** The automatic pass. A wand, with the sparks that say "and some judgement". */
export function WandIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" />
      <path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" />
      <path d="M12.2 6.2 11 5" />
    </svg>
  );
}

export function ExportIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V3m0 0L8 7m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

/** Lucide `folder-open`. */
export function FolderIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** Lucide `copy`. */
export function CopyIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/** Lucide `check`. */
export function CheckIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Lucide `x`. */
export function CloseIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Lucide `box`. */
export function PerspectiveIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  );
}

/** Lucide `focus`. */
export function FocusIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}

/** Lucide `mouse-pointer-2`. */
export function CursorIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
    </svg>
  );
}

/** Lucide `scissors`. */
export function ScissorsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  );
}

/**
 * Lucide `monitor`. What a clip's picture came from.
 *
 * Drawn at 3px inside a clip, where Lucide's 2px stroke on a 24px grid is
 * heavy enough to fill the shape in. `strokeWidth` is dropped to 1.75 for both
 * of these so the glyphs stay legible rather than turning into blobs.
 */
export function ScreenIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/** Lucide `video`. */
export function CameraIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" />
    </svg>
  );
}

export function ZoomInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 5v12h2V5zM5 11h12v2H5z" />
    </svg>
  );
}

export function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 11h12v2H5z" />
    </svg>
  );
}

export function ResetIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
    </svg>
  );
}

/**
 * Lucide `undo-2`. An arrow turning back on itself.
 *
 * Distinct from `ResetIcon`'s full circle on purpose: that one puts a control
 * back to its default, this one steps back through what was done. Two hooks in
 * the same panel meaning different things would be worse than a plain label.
 */
export function UndoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

/**
 * Lucide `command`. The looped square Apple prints on the key.
 *
 * The real glyph rather than the letters "Cmd": this is what is physically on
 * the keyboard, and a shortcut is easier to find by matching the symbol than by
 * translating a word back into one.
 */
export function CommandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 6a3 3 0 1 1 3 3h-3zm0 0v12m0 0a3 3 0 1 0 3-3h-3zM9 6a3 3 0 1 0-3 3h3zm0 0v12m0 0a3 3 0 1 1-3-3h3z" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}

/**
 * Lucide `arrow-big-up`, which is the ⇧ Apple prints on the Shift key.
 *
 * A hollow upward arrow rather than a plain chevron: the chevron is what the
 * caret key carries, and the two sitting side by side in one shortcut would be
 * indistinguishable at this size.
 */
export function ShiftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 20v-8H5l7-8 7 8h-4v8z" />
    </svg>
  );
}

/** Lucide `layout-template`. The frame and what sits in it. */
export function LayoutIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="7" x="3" y="3" rx="1" />
      <rect width="9" height="7" x="3" y="14" rx="1" />
      <rect width="5" height="7" x="16" y="14" rx="1" />
    </svg>
  );
}

/** Lucide `volume-2`. */
export function AudioIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.384 3.383A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
    </svg>
  );
}

/** Lucide `maximize-2`, for "show all of it". */
export function FitIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

/** Lucide `scan`, for "fill the frame". */
export function FillIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect width="8" height="8" x="8" y="8" rx="1" />
    </svg>
  );
}

export function CircleIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

/** A superellipse-cornered square, matching the `squircle` utility. */
export function SquircleIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 3c7 0 9 2 9 9s-2 9-9 9-9-2-9-9 2-9 9-9z" />
    </svg>
  );
}

export function RoundedIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="4" />
    </svg>
  );
}

/** Lucide `paintbrush`, for a flat colour. */
export function SolidIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3" />
      <path d="M9 8c-2 3-4 3.5-7 4l8 8c.5-3 1-5 4-7" />
      <path d="M14.5 17.5 4.5 15" />
    </svg>
  );
}

/** Lucide `blend`, for two colours running into each other. */
export function GradientIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="9" cy="9" r="7" />
      <circle cx="15" cy="15" r="7" />
    </svg>
  );
}

/** Lucide `image`. */
export function ImageIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

/** The camera at its own proportions, corners rounded and nothing cropped. */
export function WideIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="20" height="12" x="2" y="6" rx="2" />
    </svg>
  );
}

/** Lucide `zoom-in`, without the plus — a zoom span says nothing about direction. */
export function ZoomIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** Lucide `text-cursor-input`. Where text is going, not what it says. */
export function TypingIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <path d="M5 4h1a3 3 0 0 1 3 3 3 3 0 0 1 3-3h1" />
      <path d="M13 20h-1a3 3 0 0 1-3-3 3 3 0 0 1-3 3H5" />
      <path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1" />
      <path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7" />
      <path d="M9 7v10" />
    </svg>
  );
}
