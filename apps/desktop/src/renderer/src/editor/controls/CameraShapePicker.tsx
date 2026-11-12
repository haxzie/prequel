import { useEffect, useRef, type ReactNode } from "react";

import { cameraFrame } from "../../../../shared/camera-frames";
import { libraryRef } from "../../../../shared/library";
import { mediaUrl } from "../../../../shared/media-url";
import { CAMERA_SHAPES, type CameraShapeChoice } from "../cameraShape";
import { cn } from "../../lib/cn";
import { ChevronRightIcon } from "../icons";
import { CONTROL_H } from "./inputs";
import { PushedView, usePushed } from "./PushedView";

/**
 * What one row shows on its left: the frame's own artwork, or the shape's glyph.
 *
 * A frame is a picture, and a picture of it is worth more than any glyph —
 * the polaroid's strip and the television's knobs are the whole of why
 * somebody picks one. A plain shape has nothing to photograph, so it keeps the
 * outline it is offered under everywhere else in the editor. Both sit in a box
 * of the same size, or the labels beside them would not line up.
 *
 * Straight off the shelf, through `mediaUrl` — the same file the compositor
 * draws, so a row cannot come to show a frame the camera will not get. The
 * recording's name is not needed: a library reference resolves without one.
 */
function ShapeThumb({ value, icon }: { value: CameraShapeChoice; icon: ReactNode }) {
  const dressing = cameraFrame(value);

  return (
    <span
      className="flex size-9 flex-none items-center justify-center rounded-lg bg-white/5 [&_svg]:size-4"
      aria-hidden
    >
      {dressing ? (
        <img
          src={mediaUrl("", libraryRef("frames", dressing.file))}
          alt=""
          className="max-h-7 max-w-7 object-contain"
        />
      ) : (
        icon
      )}
    </span>
  );
}

/**
 * The camera's shape, as a list that takes the panel over.
 *
 * A list rather than the row of glyphs it used to be, and then the two-column
 * grid after that. Twelve answers is more than a row can hold — the last of
 * them was drawn off the edge of the panel — and more than a grid can label
 * without truncating: "No background" and "Follow me" are not glyphs, and
 * neither is a polaroid at sixteen pixels. The same shape the colour looks
 * use, for the same reason.
 *
 * **Hovering a row puts it on the camera.** A name and a line of copy say what
 * a shape is; only the preview says what it does to *this* composition, which
 * is the question actually being asked — and a frame changes the camera's
 * proportions as well as its outline, so it is the one control in the panel
 * where reading the label tells you least.
 */
export function CameraShapePicker({
  value,
  options,
  disabled,
  onChange,
  onPreview,
  icons,
}: {
  value: CameraShapeChoice;
  /**
   * Per-row overrides, by value. `disabled` greys one row and `note` replaces
   * its line — together they are how a choice this *recording* cannot offer
   * says so and why, without the list having to know what a matte is.
   */
  options?: Partial<Record<CameraShapeChoice, { disabled?: boolean; note?: string }>>;
  disabled?: boolean;
  onChange: (value: CameraShapeChoice) => void;
  /** The shape to draw instead of the chosen one while a row is hovered. */
  onPreview?: (value: CameraShapeChoice | null) => void;
  /** The glyph each plain shape is offered under, by value. */
  icons: Partial<Record<CameraShapeChoice, ReactNode>>;
}) {
  const { open, toggle, close } = usePushed("Camera");

  /**
   * Dropping the preview when the list goes away.
   *
   * Verbatim from `CameraLookPicker`, and for the reason spelled out there: a
   * row's `onPointerLeave` covers the pointer moving off it, but not the two
   * ways the list stops existing under a pointer that never moved — the click
   * that chooses, and the back arrow. Either would leave a hovered shape
   * standing in for the project's with nothing on screen to say so.
   */
  const preview = useRef(onPreview);
  preview.current = onPreview;
  useEffect(() => () => preview.current?.(null), [open]);

  const chosen = CAMERA_SHAPES.find((option) => option.value === value);

  return (
    <div className={cn("flex flex-col", disabled && "pointer-events-none opacity-40")}>
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "flex items-center justify-between gap-2 rounded-full bg-white/5 px-2.5 text-left",
          CONTROL_H,
          open && "bg-white/12",
        )}
        onClick={toggle}
      >
        <span className="truncate text-[13px] text-white">{chosen?.label ?? "Shape"}</span>
        <span className="flex-none text-editor-muted [&_svg]:size-3" aria-hidden>
          <ChevronRightIcon />
        </span>
      </button>

      <PushedView open={open && !disabled}>
        <div className="flex flex-col gap-0.5" role="radiogroup">
          {CAMERA_SHAPES.map((option) => {
            const row = options?.[option.value];
            const off = row?.disabled === true;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === value}
                aria-label={option.label}
                disabled={off}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors",
                  option.value === value
                    ? "bg-white/12 text-editor-fg"
                    : "text-editor-muted hover:bg-white/6 hover:text-editor-fg",
                  off && "opacity-35 hover:bg-transparent hover:text-editor-muted",
                )}
                // Pointer rather than mouse events, so a shape previews under a
                // trackpad hover and a pen alike. Cleared on leave rather than
                // on the next row's enter: the rows have a gap between them,
                // and a pointer resting in it would otherwise hold the last
                // row's shape on the camera indefinitely.
                //
                // Nothing previews a row that cannot be picked: the preview is
                // a promise that a click does this, and on a greyed row it
                // would not.
                onPointerEnter={() => !off && onPreview?.(option.value)}
                onPointerLeave={() => onPreview?.(null)}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                <ShapeThumb value={option.value} icon={icons[option.value]} />
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="text-[13px]">{option.label}</span>
                  <span className="text-[11px] text-editor-muted">{row?.note ?? option.note}</span>
                </span>
              </button>
            );
          })}
        </div>
      </PushedView>
    </div>
  );
}
