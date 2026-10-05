/**
 * The editor's icons, copied from `apps/desktop/src/renderer/src/editor/icons.tsx`.
 *
 * As many of the app's icons as the site draws, rather than the whole set.
 * Copied and not imported, for the reason set out in
 * `AppPreview`: `apps/web` shares no code with `apps/desktop`, so a marketing
 * page cannot become a second reason for a product module to change. The paths
 * are verbatim — a redrawn icon would be a different app in the picture.
 *
 * Kept apart from `components/icons.tsx`, which is the site's own set. Two files
 * because they answer to different things: that one is the site's, and this one
 * is a copy that is only correct while it matches its source.
 */

/** Lucide's stroke geometry, which the app's own icons are drawn on. */
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

export function ZoomIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function CursorIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
    </svg>
  );
}

export function ScreenIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

export function CameraIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" />
    </svg>
  );
}

export function PerspectiveIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  );
}

export function FocusIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}

export function PresetsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m2.5 19.6l1.3.6v-9L1.4 17c-.4 1.1.1 2.2 1.1 2.6M15.2 4.8l5 12l-7.3 3l-5-11.9v-.1zm.1-2c-.3 0-.5 0-.8.1L7.1 6c-.7.3-1.2 1-1.2 1.8c0 .2 0 .5.1.8l5 11.9c.3.8 1 1.2 1.8 1.2c.3 0 .5 0 .8-.1l7.4-3.1c1-.4 1.5-1.6 1.1-2.6L17.1 4c-.3-.8-1.1-1.2-1.8-1.2m-4.8 7.1c-.6 0-1-.4-1-1s.4-1 1-1s1 .5 1 1s-.4 1-1 1m-4.6 9.9c0 1.1.9 2 2 2h1.4l-3.4-8.3z" />
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

export function AudioIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.384 3.383A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
    </svg>
  );
}

export function CaptionsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <path d="M7 15h4M15 15h2M7 11h2M13 11h4" />
    </svg>
  );
}

export function WatermarkIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <path d="M5 22h14" />
      <path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z" />
      <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3 3 3 0 0 0-3 3c0 2 1 2 1 3.5V13" />
    </svg>
  );
}

/* The glyphs that stand beside the panel's sliders. */

export function CornerRadiusIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M5 5h6a8 8 0 0 1 8 8v6" />
    </svg>
  );
}

export function SizeIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M9 3H5a2 2 0 0 0-2 2v4M15 21h4a2 2 0 0 0 2-2v-4" />
      <path d="M8 16 16 8" />
    </svg>
  );
}

export function BorderIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <path d="M3 9h18" strokeOpacity="0.35" />
    </svg>
  );
}

export function OpacityIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <path d="M8 8h4v4H8zM12 12h4v4h-4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PaddingIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <rect width="8" height="8" x="8" y="8" rx="1.5" strokeDasharray="2 2" />
    </svg>
  );
}

export function BlurIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="16" cy="12" r="4" />
      <path d="M9 9h-2M7 12H3M9 15h-2" />
    </svg>
  );
}

export function AngleIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 20h16M4 20 16 5" />
      <path d="M12 20a8 8 0 0 0-1.6-4.8" strokeOpacity="0.45" />
    </svg>
  );
}

export function SmoothingIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 18c6 0 3-12 9-12 4 0 6 3 9 3" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function OffsetIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 21h16" />
      <rect width="10" height="8" x="7" y="4" rx="2" />
      <path d="M12 12v5" strokeDasharray="2 2" />
    </svg>
  );
}

export function LinesIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}

export function ShadowIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="12" height="12" x="3" y="3" rx="2.5" />
      <path d="M9 21h9a3 3 0 0 0 3-3V9" strokeOpacity="0.45" />
    </svg>
  );
}

export function ShadowOffsetIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="11" height="11" x="3" y="3" rx="2.5" />
      <rect width="11" height="11" x="10" y="10" rx="2.5" strokeOpacity="0.45" />
    </svg>
  );
}

export function SpeakerIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
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

/* The dock's two newest destinations, and the chrome around the panel. */

/**
 * Framework7 `camera_filters`: the look laid over the whole frame.
 *
 * Its own 56-unit box rather than the 24 every other glyph here is drawn in.
 * The rail sizes each one by its box, so it lands the same size as its
 * neighbours either way, and rescaling the path by hand would be a second
 * drawing of somebody else's icon.
 */
export function FilterIcon() {
  return (
    <svg viewBox="0 0 56 56" fill="currentColor" aria-hidden="true">
      <path d="M18.964 51.506q3.31 0 6.202-1.247a16.3 16.3 0 0 0 5.09-3.436a15.9 15.9 0 0 0 3.436-5.09q1.236-2.903 1.235-6.214q0-3.288-1.247-6.179a16.17 16.17 0 0 0-8.514-8.515q-2.892-1.247-6.202-1.247q-3.288 0-6.19 1.247a16.13 16.13 0 0 0-8.527 8.515Q3 32.231 3 35.52q0 3.31 1.247 6.213a16.1 16.1 0 0 0 3.436 5.09a16.1 16.1 0 0 0 5.09 3.436q2.903 1.247 6.19 1.247m0-3.628a12 12 0 0 1-4.785-.964a12.6 12.6 0 0 1-3.945-2.653a12.2 12.2 0 0 1-2.653-3.934q-.953-2.246-.953-4.808q0-2.54.953-4.773a12.2 12.2 0 0 1 2.653-3.923a12.6 12.6 0 0 1 3.945-2.653a12 12 0 0 1 4.785-.964q2.562 0 4.796.964a12.5 12.5 0 0 1 6.576 6.576q.963 2.234.963 4.773q0 2.563-.963 4.808a12.46 12.46 0 0 1-6.576 6.587q-2.235.963-4.796.964m9.047-11.95q3.288 0 6.18-1.236a16 16 0 0 0 5.09-3.436a16 16 0 0 0 3.436-5.09q1.236-2.892 1.235-6.202t-1.235-6.19a16.1 16.1 0 0 0-3.436-5.08a16.2 16.2 0 0 0-5.09-3.447Q31.299 4 28.01 4q-3.31 0-6.201 1.247a16.2 16.2 0 0 0-5.091 3.447a16.3 16.3 0 0 0-3.447 5.08q-1.247 2.88-1.247 6.19t1.247 6.202a16.2 16.2 0 0 0 3.447 5.09a16.1 16.1 0 0 0 5.09 3.436q2.892 1.236 6.202 1.236m0-3.629q-2.562 0-4.807-.952a12.2 12.2 0 0 1-3.934-2.653a12.6 12.6 0 0 1-2.653-3.934q-.964-2.235-.964-4.796t.964-4.785a12.7 12.7 0 0 1 2.653-3.923a12.4 12.4 0 0 1 3.934-2.664q2.246-.964 4.807-.964q2.54 0 4.774.964q2.233.963 3.934 2.653a12.2 12.2 0 0 1 2.653 3.923q.952 2.234.952 4.796t-.952 4.796a12.4 12.4 0 0 1-2.653 3.934a12.4 12.4 0 0 1-3.934 2.653q-2.234.952-4.774.952m9.048 19.207q3.288 0 6.18-1.247a16.3 16.3 0 0 0 5.09-3.436a15.9 15.9 0 0 0 3.435-5.09Q53 38.83 53 35.519q0-3.288-1.236-6.179a15.9 15.9 0 0 0-3.435-5.08a16.3 16.3 0 0 0-5.09-3.435q-2.892-1.247-6.18-1.247q-3.31 0-6.213 1.247a16.13 16.13 0 0 0-8.526 8.515q-1.247 2.891-1.247 6.18q0 3.31 1.247 6.213a16.1 16.1 0 0 0 3.435 5.09a16.1 16.1 0 0 0 5.09 3.436q2.904 1.247 6.214 1.247m0-3.628q-2.562 0-4.807-.964a12.5 12.5 0 0 1-3.934-2.653a12.5 12.5 0 0 1-2.654-3.934q-.963-2.246-.963-4.808q0-2.54.963-4.773a12.46 12.46 0 0 1 6.587-6.576q2.246-.963 4.808-.964q2.54 0 4.773.964a12.5 12.5 0 0 1 6.576 6.576q.964 2.234.964 4.773q0 2.563-.952 4.808a12.3 12.3 0 0 1-2.642 3.934a12.5 12.5 0 0 1-3.934 2.653a12 12 0 0 1-4.785.964" />
    </svg>
  );
}

/** A covered line of text: what the reader lays over a card number or a key. */
export function MaskToolIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M7 10h3" />
      <path d="M13 10h4" />
      <path d="M7 14h5" />
      <path d="M15 14h2" />
    </svg>
  );
}

/**
 * Lucide `image`: the Background panel.
 *
 * It was a palette for a long time — the glyph moved to the text panel's Style
 * tab, where a look is chosen, and what this panel mostly holds is wallpapers.
 */
export function ImageIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

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

export function AddRecordingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 8H9v3H6v2h3v3h2v-3h3v-2h-3z" />
      <path d="M18 7c0-1.103-.897-2-2-2H4c-1.103 0-2 .897-2 2v10c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2v-3.333L22 17V7l-4 3.333zm-1.999 10H4V7h12v5z" />
    </svg>
  );
}

export function ChevronUpIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function ResetIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/* The title bar, which is now three groups on the board rather than a bar. */

export function FolderIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function BugIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </svg>
  );
}

export function ExportIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.8} aria-hidden="true">
      <path d="M12 15V3m0 0L8 7m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

/** A dial with its needle: how fast a clip runs. */
export function SpeedIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M4 18a9 9 0 1 1 16 0" />
      <path d="M12 18 16 10" />
    </svg>
  );
}

/** A drop: the colour of the border round the recording. */
export function DropletIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M12 3c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10z" />
    </svg>
  );
}

/** A capital T on its baseline. The text row's glyph. */
export function TextIcon() {
  return (
    <svg {...STROKE} strokeWidth={1.75} aria-hidden="true">
      <path d="M4 7V5h16v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </svg>
  );
}
