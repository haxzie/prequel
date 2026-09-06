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
 * The field carries the colour and the mark stays white. Tinting both left the
 * mark competing with its own background at the size these are drawn, where a
 * white glyph on a tinted field reads at a glance. Each section takes the
 * colour its own timeline uses, which is the one thing tying a heading to the
 * picture beside it.
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
      className={`inline-flex items-baseline gap-[0.2em] rounded-[0.22em] border px-[0.3em] pt-[0.04em] pb-[0.12em] leading-[1] whitespace-nowrap ${tone}`}
    >
      {children}
      <span
        aria-hidden
        className="inline-flex size-[0.68em] translate-y-[0.06em] items-center justify-center text-white [&_svg]:size-full"
      >
        {mark}
      </span>
    </span>
  );
}

/** The zooms are the accent, which is what their playhead is drawn in. */
const ZOOM_TONE = "border-accent/70 bg-accent/25";
/** The layouts are iris, the clip stroke the editor's timeline uses. */
const LAYOUT_TONE = "border-iris/70 bg-iris/25";
/** The subtitles are green, which is what their own track is lit in. */
const CAPTION_TONE = "border-positive/60 bg-positive/20";

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
