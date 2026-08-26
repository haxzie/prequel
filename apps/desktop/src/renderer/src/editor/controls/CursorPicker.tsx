import { CURSOR_STYLES } from "../../../../shared/contract";
import { cn } from "../../lib/cn";

/**
 * The pointer, as a grid of the pointers themselves.
 *
 * Three names in a segmented control asked the reader to know what "Circle"
 * looks like before picking it. The artwork is the answer to that question and
 * it is already on disk — the same PNG the preview and the exporter composite,
 * so a swatch cannot come to show a pointer the recording will not get.
 *
 * The plate under each one is a mid grey rather than the panel's own dark. Both
 * tones carry an outline of the opposite tone, so either reads against
 * anything; but on a dark plate a black pointer is a white outline around
 * nothing, and the choice between black and white would be made from the two
 * captions rather than from the two pictures.
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
    <div className="grid grid-cols-3 gap-1">
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
              "flex flex-col gap-1 rounded-md p-1 text-center text-[10px]",
              "disabled:pointer-events-none disabled:opacity-30",
              style.id === value
                ? "bg-white/10 text-editor-fg ring-2 ring-editor-accent ring-inset"
                : "text-editor-muted hover:bg-white/5",
            )}
            onClick={() => onChange(style.id)}
          >
            <span className="grid aspect-square place-items-center rounded-[5px] bg-editor-fg/40">
              {/* Two fifths of the plate, which is about what the pointer takes
                  of a frame at the default size — the swatch is a picture of
                  the setting rather than of the file. */}
              <img
                src={imageUrl(style.shapes.arrow.file)}
                alt=""
                draggable={false}
                className="w-2/5 select-none"
              />
            </span>
            {style.label}
          </button>
        );
      })}
    </div>
  );
}
