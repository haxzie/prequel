/**
 * The chipped words in the three demo headings.
 *
 * The same idea as the hero's decorated words: a word the section is about gets
 * a field of its own with a mark inside it, so the heading shows what it is
 * naming before the picture beside it starts playing. The hero quotes pieces of
 * the app; these quote what the section does.
 *
 * Everything is sized in `em`. The headings run from `text-3xl` to `text-4xl`
 * across the breakpoints and the chips hold their proportions the whole way. A
 * chip with 6px of padding is a lozenge at one size and a hairline at the other.
 *
 * A wash of the hue with the word and the mark set in it, rather than a solid
 * field with both knocked out in white. The solid was forced: these carried a
 * tint on the dark site, and when the page turned to paper a tint of anything
 * was nearly the page itself, so the only way to make a chip read was to fill
 * it. The sections are cards now — see `DemoSection` — and a tint over
 * `--surface` has a ground to sit on again, which is what the dark page used
 * to supply.
 *
 * Fifteen per cent, which is as faint as the field can go and still be a field.
 * Each hue then sets its own word and glyph, and every one clears AA at the
 * size a heading sets them — these are large text, so the floor is 3:1 and the
 * weakest of the four is the accent at 3.1.
 *
 * `rounded-full` with the padding opened up to match. A full round eats into the
 * ends of a word — the same note is on the hero's title card, which is the shape
 * these now echo.
 *
 * Each section takes the colour its own timeline uses, which is the one thing
 * tying a heading to the picture beside it — so a tone changed here has to be
 * changed in that demo's `--track-accent` in `globals.css` too, or the heading
 * stops naming the thing under it. Blue, orange, green, rose, in the order the
 * sections run.
 *
 * Every chip carries `data-heading-chip`, which `SectionHeading` looks for to
 * relax its leading. Two chipped lines at the heading's default line height sit
 * close enough that the fields almost touch.
 */
import type { ReactNode } from "react";

/** Lucide's stroke geometry, which the app's own icons are drawn on. */
const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * A word on a tinted field, with its mark.
 *
 * `leading-[1]` back on the chip itself: it is inline-flex, so the heading's
 * relaxed line height would otherwise be baked into the field as well and the
 * box would stand a third of a line taller than the word inside it. The same
 * note is on the hero's chips, for the same reason.
 *
 * The mark is nudged down because an inline box sits on the baseline by its
 * edge, which leaves it riding high beside a cap-height letterform.
 */
function Chip({ tone, mark, children }: { tone: string; mark: ReactNode; children: string }) {
  return (
    <span
      data-heading-chip
      className={`inline-flex items-baseline gap-[0.2em] rounded-full px-[0.45em] pt-[0.04em] pb-[0.12em] leading-[1] whitespace-nowrap ${tone}`}
    >
      {children}
      {/* Sized to the letters beside it, which takes more than matching the
          cap height: a Lucide glyph is drawn inside about four fifths of its
          own 24-unit box, so a mark set to the cap height draws at four
          fifths of it and reads as a small icon next to a big word. `0.92em`
          is the box that puts the *drawing* on the cap height.

          Nudged down because the box's bottom sits on the baseline, which
          leaves the glyph's middle above the middle of the letters. */}
      <span
        aria-hidden
        className="inline-flex size-[0.92em] translate-y-[0.1em] items-center justify-center [&_svg]:size-full"
      >
        {mark}
      </span>
    </span>
  );
}

/** The zooms are the accent, which is what their playhead is drawn in. */
const ZOOM_TONE = "bg-accent/15 text-accent";
/** The layouts are the brand's orange, which is what their own track is drawn
    in. It was the clip's purple, and the purple plus the teleprompter's magenta
    two sections down were two notes of one hue with a green between them —
    they read as one section interrupted rather than as two. The deep value and
    not `--brand-from`, matching the track for the same reason the track picked
    it: the bright orange is 3.6:1 here and this is 5.2:1. */
const LAYOUT_TONE = "bg-brand-from-deep/15 text-brand-from-deep";
/** The subtitles are green, which is what their own track is lit in. */
const CAPTION_TONE = "bg-positive/15 text-positive";
/** The teleprompter is `--brand-to`, the far end of the gradient whose near end
    the layouts chip takes — the fourth hue, and one none of the three above it
    have. It was `--iris`, the clip stroke's #c000f0, which is the loudest value
    in the token set and took the last section's heading over. */
const SCRIPT_TONE = "bg-brand-to/15 text-brand-to";

/** A magnifier with a plus in it: zoom, rather than search. */
export function ZoomWord({ children }: { children: string }) {
  return (
    <Chip
      tone={ZOOM_TONE}
      mark={
        <svg {...STROKE}>
          <circle cx="11" cy="11" r="7" />
          <path d="M11 8v6M8 11h6" />
          <path d="m20 20-3.9-3.9" />
        </svg>
      }
    >
      {children}
    </Chip>
  );
}

/** The pointer itself. */
export function CursorWord({ children }: { children: string }) {
  return (
    <Chip
      tone={ZOOM_TONE}
      mark={
        <svg {...STROKE}>
          <path d="M4.5 3.2 19 11.4l-6.6 1.6L9.5 19z" />
        </svg>
      }
    >
      {children}
    </Chip>
  );
}

/** A frame with a second picture in the corner of it. */
export function LayoutsWord({ children }: { children: string }) {
  return (
    <Chip
      tone={LAYOUT_TONE}
      mark={
        <svg {...STROKE}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <rect x="13" y="12.5" width="5.5" height="5" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
      }
    >
      {children}
    </Chip>
  );
}

/** A bulb, for the idea. */
export function IdeasWord({ children }: { children: string }) {
  return (
    <Chip
      tone={LAYOUT_TONE}
      mark={
        <svg {...STROKE}>
          <path d="M9 18h6" />
          <path d="M10 21.5h4" />
          <path d="M12 2.5a6.5 6.5 0 0 0-3.6 11.9c.4.3.6.7.6 1.1v.5h6v-.5c0-.4.2-.8.6-1.1A6.5 6.5 0 0 0 12 2.5Z" />
        </svg>
      }
    >
      {children}
    </Chip>
  );
}

/** The captions plate, as the app's own icon draws it. */
export function SubtitlesWord({ children }: { children: string }) {
  return (
    <Chip
      tone={CAPTION_TONE}
      mark={
        <svg {...STROKE}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M7 15h4M15 15h2M7 11h2M13 11h4" />
        </svg>
      }
    >
      {children}
    </Chip>
  );
}

/** A caret between two serifs: the text cursor, sitting in a line of words. */
export function TextWord({ children }: { children: string }) {
  return (
    <Chip
      tone={CAPTION_TONE}
      mark={
        <svg {...STROKE}>
          <path d="M12 4.5v15" />
          <path d="M8.5 4.5h7M8.5 19.5h7" />
        </svg>
      }
    >
      {children}
    </Chip>
  );
}

/** The island itself — a notch with a line of script in it — rather than a
    page or a document. The product's own words for this are "the notch" and
    "the island", and the mark should be recognisable as the thing on screen
    rather than as the paper it replaces. */
export function ScriptWord({ children }: { children: string }) {
  return (
    <Chip
      tone={SCRIPT_TONE}
      mark={
        <svg {...STROKE}>
          <path d="M6 4h12a2 2 0 0 1 2 2v2a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V6a2 2 0 0 1 2-2Z" />
          <path d="M9.5 9h5" />
        </svg>
      }
    >
      {children}
    </Chip>
  );
}
