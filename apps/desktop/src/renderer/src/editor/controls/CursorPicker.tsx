import { CURSOR_STYLES } from "../../../../shared/contract";
import { cn } from "../../lib/cn";

/**
 * The pointer, as a row of the pointers themselves.
 *
 * Three names in a segmented control asked the reader to know what "Circle"
 * looks like before picking it. The artwork is the answer to that question and
 * it is already on disk — the same PNG the preview and the exporter composite,
 * so a swatch cannot come to show a pointer the recording will not get.
 *
 * One row of five, and no captions: five is all there are, so a grid that wraps
 * spent two rows saying what one says, and a name under a picture of the thing
 * it names is read by nobody. The name survives on `title` and `aria-label` —
 * the label is the accessible name once there is no text, not a nicety.
 *
 * A dark plate, which is a real trade. Every style carries an outline of the
 * opposite tone, so a black pointer on dark is legible as its white outline
 * rather than invisible — but it is legible as an *outline*, and black and
 * white are further apart on a mid grey than they are here. Dark wins anyway
 * because the swatch then shows the pointer against something like what it will
 * actually be composited over, and three of the five styles are light.
 */
export function CursorPicker({
  value,
  imageUrl,
  disabled,
  onChange,
}: {
  value: string;
  /** Turns a style's file name into something the renderer can load. */
  imageUrl: (file: string) => string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {CURSOR_STYLES.map((style) => {
        // Every style but the circle ships a pointer per shape the recording
        // may have caught, so the tooltip has to say which of the two it is —
        // the swatch shows an arrow either way.
        const shapes = Object.keys(style.shapes).length;
        const title =
          shapes > 1
            ? `${style.label} pointer, following the shape the system was showing — a hand over a link, an I-beam in text, arrows on an edge`
            : `${style.label} marker, whatever the pointer was doing`;

        return (
          <button
            key={style.id}
            type="button"
            title={title}
            aria-label={style.label}
            aria-pressed={style.id === value}
            disabled={disabled}
            className={cn(
              // The button is the plate now that there is no caption under it,
              // rather than a wrapper around one — a padded button holding a
              // square leaves the ring floating clear of the artwork it is
              // meant to be selecting.
              "grid aspect-square place-items-center rounded-md",
              "disabled:pointer-events-none disabled:opacity-30",
              style.id === value
                ? "bg-black/45 ring-2 ring-editor-accent ring-inset"
                : "bg-black/30 hover:bg-black/45",
            )}
            onClick={() => onChange(style.id)}
          >
            {/* Half the plate rather than the two fifths this was. The swatches
                are five across where they were three, so the same fraction of a
                smaller plate left the glyph too small to tell an arrow from a
                circle. */}
            <img
              src={imageUrl(style.shapes.arrow.file)}
              alt=""
              draggable={false}
              className="w-1/2 select-none"
            />
          </button>
        );
      })}
    </div>
  );
}
