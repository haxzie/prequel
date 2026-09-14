/**
 * The marks on the captions track, and the layout thumbnail under them.
 *
 * One each for the four beats, drawn rather than pulled from an icon set for
 * the reason `LayoutGlyph` is drawn: they sit at fourteen pixels beside a word
 * that disappears below `sm`, and at that size a glyph has to be three shapes
 * and no more. Everything is on a 16-unit grid and inherits `currentColor`, so
 * the slice's own lit and unlit colours carry them.
 *
 * `LayoutGlyph` lives here rather than in `LayoutDemo` because the features
 * page draws the whole picker with it. One drawing of a layout, wherever it is
 * shown, or the demo's "Beside" and the picker's come to be two shapes.
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

/**
 * One layout, as the two boxes it puts on the frame.
 *
 * `[x, y, w, h]` in the frame's own units — 16 across by 9 down — which is the
 * same coordinate space the keyframes are written in, so a glyph and the
 * picture it labels cannot disagree about which layout they are showing.
 * A screen-less layout simply has no `screen`.
 */
export interface Layout {
  name: string;
  screen?: Box;
  camera: Box;
  /** The camera is a bubble over the screen rather than a card beside it. */
  bubble?: boolean;
}

/**
 * A tuple and not `number[]`, so `noUncheckedIndexedAccess` can see that all
 * four are there. Destructuring an array of unknown length hands back four
 * `number | undefined`, and every one of them then has to be defended against
 * for a figure written six lines above.
 */
export type Box = [x: number, y: number, width: number, height: number];

/**
 * A layout as the shape it makes: the frame faint, the screen tinted
 * inside it, the camera solid.
 *
 * Drawn from the same `[x, y, w, h]` figures the slice carries, in the frame's
 * own 16-by-9 units, so there is one description of a layout rather than
 * a picture and a second drawing of it that have to be kept in agreement. It is
 * the app's own layout picker in miniature, and for its reason: two rectangles
 * are understood before "padded screen with the camera beside it, matched to
 * its height" is finished being read.
 */
export function LayoutGlyph({ layout }: { layout: Layout }) {
  const [cx, cy, cw, ch] = layout.camera;

  return (
    <svg viewBox="-0.5 -0.5 17 10" className="h-3.5 w-[1.55rem] shrink-0" aria-hidden>
      {/* The output frame, faint, behind both boxes — the edge a padded screen
          is padded *from*. Every layout that does not fill the frame needs
          something to be inset within, or it reads as a smaller frame rather
          than as a smaller picture in the same one. */}
      <rect
        x="0"
        y="0"
        width="16"
        height="9"
        rx="0.8"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="0.9"
      />

      {layout.screen ? (
        <rect
          x={layout.screen[0]}
          y={layout.screen[1]}
          width={layout.screen[2]}
          height={layout.screen[3]}
          rx="0.8"
          // Tinted, where the camera below is solid. Outlining both left a
          // full-frame screen and a padded one as the same rectangle drawn a
          // hair smaller; filling the screen turns the difference into an area,
          // which survives being fourteen pixels tall.
          fill="currentColor"
          fillOpacity="0.3"
          stroke="currentColor"
          strokeWidth="0.9"
        />
      ) : null}

      {/* A bubble is a squircle and a card is a slightly-rounded rectangle, the
          same two shapes the picture uses — so the corner radius is the whole
          difference, and at this size it is enough of one. */}
      <rect
        x={cx}
        y={cy}
        width={cw}
        height={ch}
        rx={layout.bubble ? cw * 0.32 : 0.8}
        fill="currentColor"
      />
    </svg>
  );
}
