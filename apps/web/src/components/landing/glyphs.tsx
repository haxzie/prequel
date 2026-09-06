/**
 * The marks on the captions track.
 *
 * One each for the four beats, drawn rather than pulled from an icon set for
 * the reason `LayoutGlyph` is drawn: they sit at fourteen pixels beside a word
 * that disappears below `sm`, and at that size a glyph has to be three shapes
 * and no more. Everything is on a 16-unit grid and inherits `currentColor`, so
 * the slice's own lit and unlit colours carry them.
 */

/** A plate with a word lit on it: the `Highlight` look. */
export function HighlightGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
      <rect
        x="1.5"
        y="4.5"
        width="13"
        height="7"
        rx="1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M4 8h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* The lit word, solid where its neighbours are strokes. */}
      <rect x="8.4" y="7.1" width="3.6" height="1.8" rx="0.6" fill="currentColor" />
    </svg>
  );
}

/** A bar the full width of the frame: the `Band` look. */
export function BandGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
      <rect
        x="1.5"
        y="3"
        width="13"
        height="10"
        rx="1.6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.2"
      />
      <rect x="1.5" y="8" width="13" height="3.4" fill="currentColor" fillOpacity="0.85" />
    </svg>
  );
}

/** Three words, the last of them soft: the `Blur in` look. */
export function BlurGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
      <g fill="currentColor">
        <rect x="1.5" y="7" width="3.4" height="2" rx="0.8" />
        <rect x="6" y="7" width="3.4" height="2" rx="0.8" fillOpacity="0.55" />
        <rect x="10.5" y="7" width="3.4" height="2" rx="0.8" fillOpacity="0.22" />
      </g>
    </svg>
  );
}

/** A caption plate with two lines of words on it. */
export function CaptionsGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
      <rect
        x="1.5"
        y="3.5"
        width="13"
        height="9"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M4 7h3.5" />
        <path d="M9.5 7h2.5" />
        <path d="M4 9.5h2" />
        <path d="M8 9.5h4" />
      </g>
    </svg>
  );
}

/** Typing over what was heard. */
export function PencilGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11.4 2.6a1.7 1.7 0 0 1 2.4 2.4L5.6 13.2 2.4 14l.8-3.2z" />
        <path d="M10.2 3.8l2 2" />
      </g>
    </svg>
  );
}

/** The cut the delete makes. */
export function CutGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="4" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M5.4 10.6 12.5 3" />
        <path d="M10.6 10.6 3.5 3" />
      </g>
    </svg>
  );
}
