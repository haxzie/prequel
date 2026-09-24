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

/**
 * Lucide `check-check`. Two ticks: this one, and then all of them.
 *
 * The doubling is the whole message — a single tick says "done", and what this
 * button does is say it again for every clip that is not in front of you.
 */
export function ApplyAllIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </svg>
  );
}

/**
 * Tabler `radius-top-right`, by Paweł Kuna (MIT). How round a corner is.
 *
 * Tabler rather than Lucide, which has no corner-radius glyph — and it lands on
 * the same 24px grid at the same 2px stroke, so it needs no adjusting to sit
 * beside the rest.
 *
 * Distinct from `RoundedIcon`, which is a *shape*: that one is one of the five
 * swatches in the camera's shape picker and has to read as a rounded square
 * next to a circle and a squircle. This is the quantity — a single corner with
 * its arc — and it belongs on the sliders that set one.
 */
export function CornerRadiusIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M5 5h6a8 8 0 0 1 8 8v6" />
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

/** Lucide `link`. */
export function LinkIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
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
/**
 * Streamline `arrow-cursor-2`, CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
 *
 * The mouse whose click is chosen. Its own box of 14 rather than `STROKE`'s
 * 24, with the stroke scaled to match, because the glyph is drawn to that box
 * and restating its path at 24 would be a transcription nobody could check.
 */
export function MouseIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.753 4.67L1.83 1.106a.564.564 0 0 0-.704.732l4.04 10.932a.35.35 0 0 0 .663-.015l1.53-4.81a1 1 0 0 1 .575-.623l4.845-1.982a.358.358 0 0 0-.025-.672" />
    </svg>
  );
}

/** Lucide `keyboard`. The keyboard whose sound is chosen, not a shortcut. */
export function KeyboardIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
    </svg>
  );
}

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
/**
 * Lucide `corner-down-left`. The return key, drawn inside the field it submits.
 *
 * The glyph on the key rather than the word "Save": it sits in a box the width
 * of a name, and what it is telling you is which key already does this.
 */
export function ReturnIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M9 10 4 15l5 5" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </svg>
  );
}

/**
 * Lucide `stamp`. The logo laid over a composition.
 *
 * A stamp rather than a picture-in-a-frame, which is what this was: that glyph
 * said "an image", and the background's picker says that already. A stamp says
 * *pressed onto* something, which is the part that distinguishes a watermark
 * from every other image setting in the editor.
 */
export function WatermarkIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <path d="M5 22h14" />
      <path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z" />
      <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3 3 3 0 0 0-3 3c0 2 1 2 1 3.5V13" />
    </svg>
  );
}

/**
 * Framework7 `camera_filters`: the look laid over the whole frame.
 *
 * Three glass discs overlapping, which is what a filter *is* to anyone who has
 * put one on a lens — rather than the funnel most interfaces reach for. A
 * funnel means narrowing a list, which in an editor is exactly the wrong
 * promise: these change how the picture looks, they do not hide any of it.
 *
 * Its own 56-unit box rather than the 24 the rest of this file uses. The path
 * is drawn in those units and rescaling it by hand would be a second drawing of
 * somebody else's icon; the rail sizes every glyph by its box, so it lands the
 * same size as its neighbours either way.
 */
export function FilterIcon() {
  return (
    <svg viewBox="0 0 56 56" fill="currentColor" aria-hidden="true">
      <path d="M18.964 51.506q3.31 0 6.202-1.247a16.3 16.3 0 0 0 5.09-3.436a15.9 15.9 0 0 0 3.436-5.09q1.236-2.903 1.235-6.214q0-3.288-1.247-6.179a16.17 16.17 0 0 0-8.514-8.515q-2.892-1.247-6.202-1.247q-3.288 0-6.19 1.247a16.13 16.13 0 0 0-8.527 8.515Q3 32.231 3 35.52q0 3.31 1.247 6.213a16.1 16.1 0 0 0 3.436 5.09a16.1 16.1 0 0 0 5.09 3.436q2.903 1.247 6.19 1.247m0-3.628a12 12 0 0 1-4.785-.964a12.6 12.6 0 0 1-3.945-2.653a12.2 12.2 0 0 1-2.653-3.934q-.953-2.246-.953-4.808q0-2.54.953-4.773a12.2 12.2 0 0 1 2.653-3.923a12.6 12.6 0 0 1 3.945-2.653a12 12 0 0 1 4.785-.964q2.562 0 4.796.964a12.5 12.5 0 0 1 6.576 6.576q.963 2.234.963 4.773q0 2.563-.963 4.808a12.46 12.46 0 0 1-6.576 6.587q-2.235.963-4.796.964m9.047-11.95q3.288 0 6.18-1.236a16 16 0 0 0 5.09-3.436a16 16 0 0 0 3.436-5.09q1.236-2.892 1.235-6.202t-1.235-6.19a16.1 16.1 0 0 0-3.436-5.08a16.2 16.2 0 0 0-5.09-3.447Q31.299 4 28.01 4q-3.31 0-6.201 1.247a16.2 16.2 0 0 0-5.091 3.447a16.3 16.3 0 0 0-3.447 5.08q-1.247 2.88-1.247 6.19t1.247 6.202a16.2 16.2 0 0 0 3.447 5.09a16.1 16.1 0 0 0 5.09 3.436q2.892 1.236 6.202 1.236m0-3.629q-2.562 0-4.807-.952a12.2 12.2 0 0 1-3.934-2.653a12.6 12.6 0 0 1-2.653-3.934q-.964-2.235-.964-4.796t.964-4.785a12.7 12.7 0 0 1 2.653-3.923a12.4 12.4 0 0 1 3.934-2.664q2.246-.964 4.807-.964q2.54 0 4.774.964q2.233.963 3.934 2.653a12.2 12.2 0 0 1 2.653 3.923q.952 2.234.952 4.796t-.952 4.796a12.4 12.4 0 0 1-2.653 3.934a12.4 12.4 0 0 1-3.934 2.653q-2.234.952-4.774.952m9.048 19.207q3.288 0 6.18-1.247a16.3 16.3 0 0 0 5.09-3.436a15.9 15.9 0 0 0 3.435-5.09Q53 38.83 53 35.519q0-3.288-1.236-6.179a15.9 15.9 0 0 0-3.435-5.08a16.3 16.3 0 0 0-5.09-3.435q-2.892-1.247-6.18-1.247q-3.31 0-6.213 1.247a16.13 16.13 0 0 0-8.526 8.515q-1.247 2.891-1.247 6.18q0 3.31 1.247 6.213a16.1 16.1 0 0 0 3.435 5.09a16.1 16.1 0 0 0 5.09 3.436q2.904 1.247 6.214 1.247m0-3.628q-2.562 0-4.807-.964a12.5 12.5 0 0 1-3.934-2.653a12.5 12.5 0 0 1-2.654-3.934q-.963-2.246-.963-4.808q0-2.54.963-4.773a12.46 12.46 0 0 1 6.587-6.576q2.246-.963 4.808-.964q2.54 0 4.773.964a12.5 12.5 0 0 1 6.576 6.576q.964 2.234.964 4.773q0 2.563-.952 4.808a12.3 12.3 0 0 1-2.642 3.934a12.5 12.5 0 0 1-3.934 2.653a12 12 0 0 1-4.785.964" />
    </svg>
  );
}

/** Three dots: the card's own menu, for the things that are not applying it. */
export function EllipsisIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

/**
 * Saved looks. Material Design Icons' `palette-swatch-outline`, by
 * Pictogrammers (Apache 2.0).
 *
 * Filled rather than stroked, so it does not take `STROKE` — MDI draws on the
 * same 24px grid as Lucide but as solid geometry, and the path is inlined
 * verbatim for the reason the file header gives about the Lucide ones: redrawing
 * a familiar icon by hand is how you end up with something that reads as
 * almost-right.
 */
export function PresetsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m2.5 19.6l1.3.6v-9L1.4 17c-.4 1.1.1 2.2 1.1 2.6M15.2 4.8l5 12l-7.3 3l-5-11.9v-.1zm.1-2c-.3 0-.5 0-.8.1L7.1 6c-.7.3-1.2 1-1.2 1.8c0 .2 0 .5.1.8l5 11.9c.3.8 1 1.2 1.8 1.2c.3 0 .5 0 .8-.1l7.4-3.1c1-.4 1.5-1.6 1.1-2.6L17.1 4c-.3-.8-1.1-1.2-1.8-1.2m-4.8 7.1c-.6 0-1-.4-1-1s.4-1 1-1s1 .5 1 1s-.4 1-1 1m-4.6 9.9c0 1.1.9 2 2 2h1.4l-3.4-8.3z" />
    </svg>
  );
}

/** Saves what is on screen as a look. */
export function AddPresetIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

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

/**
 * A person, solid.
 *
 * Filled rather than stroked because of where it is used: the camera block in a
 * layout thumbnail is a dozen pixels across at its smallest, and a two-pixel
 * outline at that size closes up into a grey smudge. A silhouette keeps its
 * shape all the way down.
 *
 * Drawn hard against the edges of its box, unlike the Lucide glyphs above,
 * which all carry a couple of units of air. Air is what there is least of here:
 * the glyph is already down to seven pixels in the smallest cell, and a margin
 * baked into the artwork would spend a third of that on nothing.
 */
export function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="6.5" r="5.5" />
      <path d="M12 13.6c6.1 0 11 3.7 11 8.2V24H1v-2.2c0-4.5 4.9-8.2 11-8.2z" />
    </svg>
  );
}

/** A person lifted off their background: the frame behind them is dashed. */
export function CutoutIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="2 3" strokeOpacity="0.5" />
      <circle cx="12" cy="9" r="3" />
      <path d="M6.5 21c.5-3.5 2.8-5.5 5.5-5.5s5 2 5.5 5.5" />
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

/** Lucide `palette`, for the paint behind the picture. */
export function BackdropIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
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

/** The same plate as `WideIcon`, stood on end: taller than it is wide. */
export function PortraitIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="12" height="20" x="6" y="2" rx="2" />
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

/**
 * `ZoomIcon` with a plus in the lens: the transport's Add Zoom button.
 *
 * Built on the same glyph rather than on Lucide's `zoom-in`, whose lens is a
 * size larger — side by side with the bars on the zoom row, which carry
 * `ZoomIcon`, the button should read as "one of those, added" and not as a
 * different magnifier.
 */
export function AddZoomIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </svg>
  );
}

/** Lucide `type`: a capital T on its baseline. The text row's glyph. */
export function TextIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <path d="M4 7V5h16v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </svg>
  );
}

/** `TextIcon` with a plus beside it: the transport's Add Text button. */
export function AddTextIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <path d="M3 7V5h12v2" />
      <path d="M9 5v14" />
      <path d="M6 19h6" />
      <path d="M18 12v6" />
      <path d="M15 15h6" />
    </svg>
  );
}

/**
 * Material Symbols `cinematic_blur`: the transport's Add Recording button.
 *
 * A strip of film with somebody on it — another take of the same recording,
 * which is what the button adds. Filled rather than stroked, unlike the two
 * transport glyphs beside it: it is a Material glyph drawn as one solid path,
 * and re-cutting it as strokes would be a second drawing of somebody else's
 * icon, and a worse one. The same 24-unit box, so the three sit on one
 * baseline.
 */
export function AddRecordingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m4 3l2 4h3L7 3h2l2 4h3l-2-4h2l2 4h3l-2-4h3q.825 0 1.413.588T22 5v14q0 .825-.587 1.413T20 21H4q-.825 0-1.412-.587T2 19V5q0-.825.588-1.412T4 3m4 15h8v-.55q0-1.1-1.1-1.775T12 15t-2.9.675T8 17.45zm5.413-4.587Q14 12.825 14 12t-.587-1.412T12 10t-1.412.588T10 12t.588 1.413T12 14t1.413-.587" />
    </svg>
  );
}

/** Lucide `move`: the four-way arrows of a position control. */
export function MoveIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 2v20M2 12h20" />
      <path d="m15 19-3 3-3-3M19 9l3 3-3 3M5 9l-3 3 3 3M9 5l3-3 3 3" />
    </svg>
  );
}

// ── Text motions ────────────────────────────────────────────────────────────
//
// One glyph per way a text can arrive or leave, for the picker to set beside
// each name. Every one is Lucide's, so the row of them reads as one set: the
// arrows are `move-*`, which carry the whole line the text travels along.

/** Lucide `ban`: no motion at all. */
export function NoMotionIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>
  );
}

/** Lucide `circle-dashed`: a shape that is only partly there. */
export function FadeIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M10.1 2.182a10 10 0 0 1 3.8 0" />
      <path d="M13.9 21.818a10 10 0 0 1-3.8 0" />
      <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" />
      <path d="M2.182 13.9a10 10 0 0 1 0-3.8" />
      <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" />
      <path d="M21.818 10.1a10 10 0 0 1 0 3.8" />
      <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" />
      <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" />
    </svg>
  );
}

/** Lucide `move-up`. */
export function RiseIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M8 6 12 2l4 4" />
      <path d="M12 2v20" />
    </svg>
  );
}

/** Lucide `move-down`. */
export function DropIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m8 18 4 4 4-4" />
      <path d="M12 2v20" />
    </svg>
  );
}

/** Lucide `move-right`: arriving from the left, travelling right. */
export function FromLeftIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m18 8 4 4-4 4" />
      <path d="M2 12h20" />
    </svg>
  );
}

/** Lucide `move-left`: arriving from the right, travelling left. */
export function FromRightIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m6 8-4 4 4 4" />
      <path d="M2 12h20" />
    </svg>
  );
}

/** Lucide `expand`: growing from its own centre. */
export function PopIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8" />
      <path d="M3 16.2V21m0 0h4.8M3 21l6-6" />
      <path d="M21 7.8V3m0 0h-4.8M21 3l-6 6" />
      <path d="M3 7.8V3m0 0h4.8M3 3l6 6" />
    </svg>
  );
}

/** Lucide `keyboard`: one key at a time. */
export function TypewriterIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
    </svg>
  );
}

/** Lucide `whole-word`: one word at a time. */
export function WordsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="7" cy="12" r="3" />
      <path d="M10 9v6" />
      <circle cx="17" cy="12" r="3" />
      <path d="M14 7v8" />
      <path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" />
    </svg>
  );
}

/** Lucide `captions`. The CC plate, drawn as two short runs of text. */
export function CaptionsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <path d="M7 15h4M15 15h2M7 11h2M13 11h4" />
    </svg>
  );
}

/** Lucide `chevron-left`: the way back from a view pushed over a panel. */
export function BackIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/** Lucide `pencil`. */
export function PencilIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
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

/**
 * ⌥, the glyph Apple prints on the Option key.
 *
 * Drawn rather than taken from Lucide, which has no Option symbol. Two strokes:
 * the switch that rises left to right, and the short bar above it. Same reason
 * as `CommandIcon` — the symbol on the key is easier to match than the word.
 */
export function OptionIcon() {
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
      <path d="M3 7h6l7 10h5" />
      <path d="M14 7h7" />
    </svg>
  );
}

/**
 * ⌃, the glyph on the Control key.
 *
 * A plain chevron, which is the one case where that is correct — this is the
 * caret Apple prints, not a stand-in for it.
 */
export function ControlIcon() {
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
      <path d="m5 15 7-7 7 7" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Slider icons.

   One per slider in the inspector, standing outside the track. They are read
   in a column beside a column of words, so each is drawn as the *shape of the
   quantity* rather than as a picture of the thing it belongs to — an angle is
   an angle, padding is a box inside a box, a distance is a gap with an edge on
   one side. A row of pictures of cameras and cursors would say which panel you
   were in, which the panel already says.
   ──────────────────────────────────────────────────────────────────────────── */

/** Two corners drawn apart: the measure between a thing and its box. */
export function SizeIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M9 3H5a2 2 0 0 0-2 2v4M15 21h4a2 2 0 0 0 2-2v-4" />
      <path d="M8 16 16 8" />
    </svg>
  );
}

/** A path easing out of a corner rather than turning it. */
export function SmoothingIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 18c6 0 3-12 9-12 4 0 6 3 9 3" />
    </svg>
  );
}

/** A shape and the streak it leaves behind it. */
export function BlurIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="16" cy="12" r="4" />
      <path d="M9 9h-2M7 12H3M9 15h-2" />
    </svg>
  );
}

/** An upright line beside the same line leaned off it: the angle a lean is. */
export function LeanIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 20V5" strokeDasharray="2 3" />
      <path d="M12 20 17 6" />
      <path d="M9.5 12a6 6 0 0 1 1-6.5" />
    </svg>
  );
}

/** A clock: the wait before something happens. */
export function ClockIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Stacked rules: how many lines are allowed. */
export function LinesIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}

/** A gap held between a thing and the edge it is kept off. */
export function OffsetIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 21h16" />
      <rect width="10" height="8" x="7" y="4" rx="2" />
      <path d="M12 12v5" strokeDasharray="2 2" />
    </svg>
  );
}

/** A box inside a box: the room kept around the picture. */
export function PaddingIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <rect width="8" height="8" x="8" y="8" rx="1.5" strokeDasharray="2 2" />
    </svg>
  );
}

/** The outline itself, thick enough to be the subject. */
export function BorderIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <path d="M3 9h18" strokeOpacity="0.35" />
    </svg>
  );
}

/**
 * The transparency checker, which is what "opacity" looks like everywhere.
 *
 * This was a square with two rules across it, which read as a list rather than
 * as a see-through thing. Two filled squares on the diagonal is the smallest
 * checker that still reads as one at sixteen pixels.
 */
export function OpacityIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <path d="M8 8h4v4H8zM12 12h4v4h-4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * A drop, for the fields that pick a colour.
 *
 * Those used to borrow the icon of the thing being coloured — `BorderIcon` sat
 * beside both "Width" and "Colour", so the column had the same glyph twice
 * saying different things. The group heading already says what is being
 * coloured; this says that a colour is what is being chosen.
 */
export function DropletIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 3c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10z" />
    </svg>
  );
}

/** Points at what opens below it. */
export function ChevronDownIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A shape and the one it casts. */
export function ShadowIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="12" height="12" x="3" y="3" rx="2.5" />
      <path d="M9 21h9a3 3 0 0 0 3-3V9" strokeOpacity="0.45" />
    </svg>
  );
}

/** The same, pushed off its own position. */
export function ShadowOffsetIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="11" height="11" x="3" y="3" rx="2.5" />
      <rect width="11" height="11" x="10" y="10" rx="2.5" strokeOpacity="0.45" />
    </svg>
  );
}

/** Two arms off a vertex, which is what the number means. */
export function AngleIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 20h16M4 20 16 5" />
      <path d="M12 20a8 8 0 0 0-1.6-4.8" strokeOpacity="0.45" />
    </svg>
  );
}

/** A loudspeaker, for the two that are volumes. */
export function SpeakerIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
    </svg>
  );
}

/** A microphone, so the two volumes are told apart by their source. */
export function MicIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="6" height="11" x="9" y="2" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}

/** A needle swung round a dial. */
export function SpeedIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 18a9 9 0 1 1 16 0" />
      <path d="M12 18 16 10" />
    </svg>
  );
}

/** A plate leaning away from the eye: how far in the scene goes. */
export function DepthIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 6 20 3v18L4 18z" />
      <path d="M4 6v12" strokeOpacity="0.45" />
    </svg>
  );
}

/** A plate tipped about its horizontal axis. */
export function TiltIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 8h18M5 8l3 11h8l3-11" />
      <path d="M3 8 12 4l9 4" strokeOpacity="0.45" />
    </svg>
  );
}

/** The same about its vertical one. */
export function YawIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M8 3v18M8 3l11 3v12L8 21" />
      <path d="M8 3 3 6v12l5 3" strokeOpacity="0.45" />
    </svg>
  );
}

/** A frame darkened towards its corners. */
export function VignetteIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <circle cx="12" cy="12" r="5" strokeOpacity="0.45" />
    </svg>
  );
}

/** How hard an effect is applied. */
export function StrengthIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M5 19V9M12 19V5M19 19v-6" />
    </svg>
  );
}

/** How far a zoom goes in. */
export function LevelIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <path d="M9 15 15 9M15 9h-4M15 9v4" />
    </svg>
  );
}

/** A shape and its reflection across a vertical axis. */
export function MirrorIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 3v18" strokeDasharray="2 3" />
      <path d="M9 6 4 12l5 6z" />
      <path d="M15 6l5 6-5 6z" strokeOpacity="0.45" />
    </svg>
  );
}

/** An eye struck through: the thing is there and not being shown. */
export function EyeOffIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.4 2.9" />
      <path d="M6.5 8.1A15.6 15.6 0 0 0 3 12s4 6 9 6a8.7 8.7 0 0 0 3.4-.7" />
      <path d="M9.9 10.1a3 3 0 0 0 4.1 4.2" />
    </svg>
  );
}

/** An eye: whether the thing is shown at all. */
export function EyeIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

/** A frame with a mark in it: where in the picture a thing sits. */
export function PlaceIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <circle cx="16" cy="16" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A letterform: which face the words are set in. */
export function FontIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M5 19 12 5l7 14M8.2 14h7.6" />
    </svg>
  );
}
