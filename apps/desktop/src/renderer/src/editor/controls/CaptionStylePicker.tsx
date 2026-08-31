import { CAPTION_STYLES, type CaptionStyle } from "../../../../shared/captions";
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
 */
export function CaptionStylePicker({
  value,
  accent,
  disabled,
  onChange,
}: {
  value: string;
  /** The lit-word colour, so a swatch shows the choice actually in force. */
  accent: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {CAPTION_STYLES.map((style) => (
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
              ? "bg-white/10 text-editor-fg ring-2 ring-editor-accent ring-inset"
              : "text-editor-muted hover:bg-white/5",
          )}
          onClick={() => onChange(style.id)}
        >
          {/* A mid grey rather than the panel's own dark, for the reason the
              cursor swatches carry one: every look is white text with a dark
              treatment, and on the panel's black they would all read the same. */}
          <span className="grid aspect-video place-items-center overflow-hidden rounded-[5px] bg-editor-fg/30">
            <Sample style={style} accent={accent} />
          </span>
          {style.label}
        </button>
      ))}
    </div>
  );
}

/** Two words, so a lit style has something to light. */
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
      }}
    >
      Just <span style={style.lit ? { color: accent } : undefined}>so</span>
    </span>
  );
}
