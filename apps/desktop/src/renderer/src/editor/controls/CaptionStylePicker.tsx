import {
  CAPTION_ANIMATIONS,
  CAPTION_LOOKS,
  captionStyle,
  type CaptionStyle,
} from "../../../../shared/captions";
import { cn } from "../../lib/cn";

/**
 * The caption look, as a grid of the looks themselves.
 *
 * Each swatch is drawn from the same `CaptionStyle` record the rasteriser
 * reads, for the reason `LayoutPicker` gives about its thumbnails: a swatch
 * drawn by hand is a second implementation of the look, and it goes wrong
 * quietly — the picker keeps promising something the export stopped doing.
 *
 * It is CSS rather than a canvas, so it is an impression and not a proof:
 * the plate, the weight, the stroke and the lit word are all real, but the
 * wrapping and the exact metrics are the browser's. That is the honest limit of
 * a 60px swatch, and the preview beside it is the thing that has to be exact.
 *
 * Every swatch carries the arrival that is actually chosen, rather than none.
 * The two grids each vary one axis and hold the other, so what a swatch shows
 * is the combination picking it would give you — not the look in the abstract,
 * which is a thing the editor never draws.
 */
export function CaptionStylePicker({
  value,
  animation,
  accent,
  disabled,
  onChange,
}: {
  value: string;
  /** The arrival in force, so each look is shown arriving the way it would. */
  animation: string;
  /** The lit-word colour, so a swatch shows the choice actually in force. */
  accent: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {CAPTION_LOOKS.map((look) => captionStyle(look.id, animation)).map((style) => (
        <button
          key={style.id}
          type="button"
          title={style.label}
          aria-label={style.label}
          aria-pressed={style.id === value}
          disabled={disabled}
          className={cn(
            "flex flex-col gap-1 rounded-md p-1 text-center text-[10px]",
            "disabled:pointer-events-none disabled:opacity-30",
            style.id === value
              ? "bg-white/10 text-editor-fg ring-2 ring-selected ring-inset"
              : "text-editor-muted hover:bg-white/5",
          )}
          onClick={() => onChange(style.id)}
        >
          {/* No plate behind the sample. It carried a mid grey so that looks
              which are white text on a dark treatment had something to be dark
              against — a translucent plate over the panel's own near-black is
              close to invisible, so those samples now read as plain white text
              and are told apart by weight, tracking and case rather than by
              what sits behind them. */}
          <span className="grid aspect-video place-items-center overflow-hidden rounded-[5px]">
            <Sample style={style} accent={accent} />
          </span>
          {style.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How the words arrive, as a grid of the same swatch arriving each way.
 *
 * Held against the look in force for the reason given above. A "Focus" swatch
 * drawn on the subtitle pill and one drawn on the plain look are different
 * pictures, and the useful one is the one you are about to get.
 */
export function CaptionAnimationPicker({
  value,
  look,
  accent,
  disabled,
  onChange,
}: {
  value: string;
  /** The look in force, which the swatches are drawn in. */
  look: string;
  accent: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {CAPTION_ANIMATIONS.map((animation) => (
        <button
          key={animation.id}
          type="button"
          title={animation.label}
          aria-label={animation.label}
          aria-pressed={animation.id === value}
          disabled={disabled}
          className={cn(
            "flex flex-col gap-1 rounded-md p-1 text-center text-[10px]",
            "disabled:pointer-events-none disabled:opacity-30",
            animation.id === value
              ? "bg-white/10 text-editor-fg ring-2 ring-selected ring-inset"
              : "text-editor-muted hover:bg-white/5",
          )}
          onClick={() => onChange(animation.id)}
        >
          <span className="grid aspect-video place-items-center overflow-hidden rounded-[5px]">
            <Sample style={captionStyle(look, animation.id)} accent={accent} />
          </span>
          {animation.label}
        </button>
      ))}
    </div>
  );
}

/** Two words, so a look that fills its line has something half-filled. */
function Sample({ style, accent }: { style: CaptionStyle; accent: string }) {
  // 13px of swatch standing in for the frame's shorter edge: every fraction in
  // the record is against the font size, so one number scales the whole look.
  const size = 13 * style.scale;

  return (
    <span
      style={{
        fontSize: `${size}px`,
        fontWeight: style.weight,
        letterSpacing: `${style.tracking}em`,
        textTransform: style.caps ? "uppercase" : "none",
        color: style.fill,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        ...(style.plate
          ? {
              backgroundColor: style.plate.color,
              borderRadius: `${style.plate.radius}em`,
              padding: `${style.plate.padY}em ${style.plate.padX}em`,
              // The band runs the width of the frame; the pill only fits its line.
              ...(style.plate.full ? { width: "100%", textAlign: "center" as const } : {}),
            }
          : {}),
        ...(style.stroke
          ? {
              WebkitTextStroke: `${style.stroke.width * size}px ${style.stroke.color}`,
              // Without this the stroke is drawn over the fill and eats half the
              // glyph, which at swatch size reads as a much thinner letterform.
              paintOrder: "stroke fill",
            }
          : {}),
        ...(style.shadow
          ? {
              textShadow: `0 ${style.shadow.dy * size}px ${style.shadow.blur * size}px ${style.shadow.color}`,
            }
          : {}),
        // Part way through, not at the start: a swatch is one moment, and the
        // moment worth showing is the one that says what the look does. At the
        // full radius it is an unreadable smear, and at none of it the swatch
        // is indistinguishable from the sharp looks beside it.
        ...(style.blurIn ? { filter: `blur(${style.blurIn * size * 0.35}px)` } : {}),
      }}
    >
      {/* The first word still to come, the second already said: the one moment
          that says what a look does with a line. A look that holds nothing
          back draws both the same, which is equally the truth about it. */}
      <span style={style.dim !== null ? { opacity: style.dim } : undefined}>Just</span>{" "}
      <span style={style.lit ? { color: accent } : undefined}>so</span>
    </span>
  );
}
