import { useEffect, useLayoutEffect, useRef } from "react";

import { CAMERA_LOOKS, cameraLook, resolveGrade } from "../../../../shared/camera-looks";
import { paintLookThumb } from "../lookThumb";
import { cn } from "../../lib/cn";
import { ChevronRightIcon } from "../icons";
import { CONTROL_H } from "./inputs";
import { PushedView, usePushed } from "./PushedView";

/**
 * One look, on a reference picture, drawn through the real grading shader.
 *
 * A canvas rather than an image, because the swatch is computed — see
 * `lookThumb`, which compiles the compositor's own GLSL so a swatch cannot
 * come to show a look the camera will not get.
 *
 * Painted in a layout effect rather than on render: the canvas has to exist and
 * have its backing size before anything can be drawn into it.
 *
 * The element is captured rather than read off the ref inside, because the
 * paint waits on the reference picture decoding — so by the time it lands the
 * row may have gone, and a ref read then would be null. Painting into a canvas
 * that has left the document is harmless; reading a null one is not.
 */
function LookThumb({ look }: { look: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const target = canvas.current;
    if (target) void paintLookThumb(target, resolveGrade(look, 1));
  }, [look]);

  return (
    <canvas
      ref={canvas}
      // Twice the drawn size, so it is sharp on a Retina display. Not through
      // devicePixelRatio: the list is a fixed size in a fixed window, and a
      // ratio read at mount is a value that goes stale when the window moves
      // to another display.
      width={64}
      height={88}
      className="h-11 w-8 flex-none rounded-md bg-black/40 object-cover"
      aria-hidden
    />
  );
}

/**
 * The look the camera wears, as a list that takes the panel over.
 *
 * A list rather than a segmented row, for the reason the font and the colour
 * are lists: six names with a line of explanation each do not fit across a
 * 384px panel, and the explanation is most of the value — "Cool" means nothing
 * until it says *for a warm bulb overhead*.
 *
 * **Hovering a row puts it on the picture.** A swatch says what a look does;
 * only the preview says what it does *to you*, which is the question actually
 * being asked — the two answer different halves of it, and the list carries
 * both. The same gesture the font list uses, and for the same reason.
 */
export function CameraLookPicker({
  value,
  disabled,
  onChange,
  onPreview,
}: {
  value: string;
  disabled?: boolean;
  onChange: (id: string) => void;
  /** The look to draw instead of the chosen one while a row is hovered. */
  onPreview?: (id: string | null) => void;
}) {
  const { open, toggle, close } = usePushed("Effects");

  /**
   * Dropping the preview when the list goes away.
   *
   * A row's `onPointerLeave` covers the pointer moving off it, but not the two
   * ways the list stops existing under a pointer that never moved: the click
   * that chooses a look closes the view, and the back arrow closes it from the
   * header. Either would leave a hovered look standing in for the project's
   * setting with nothing on screen to say so — and unlike a font, a colour
   * grade is not obvious from the control once the list has gone.
   *
   * Through a ref, so the cleanup is not torn down and re-run every time the
   * callback's identity changes: it is an inline closure at the call site, so
   * that is every render, and re-running this would clear a preview the
   * pointer is still sitting on. Verbatim from `FontPicker`.
   */
  const preview = useRef(onPreview);
  preview.current = onPreview;
  useEffect(() => () => preview.current?.(null), [open]);

  const chosen = cameraLook(value);

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
        <span className="truncate text-[13px] text-white">{chosen.label}</span>
        <span className="flex-none text-editor-muted [&_svg]:size-3" aria-hidden>
          <ChevronRightIcon />
        </span>
      </button>

      <PushedView open={open && !disabled}>
        <div className="flex flex-col gap-0.5" role="radiogroup">
          {CAMERA_LOOKS.map((look) => (
            <button
              key={look.id}
              type="button"
              role="radio"
              aria-checked={look.id === value}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors",
                look.id === value
                  ? "bg-white/12 text-editor-fg"
                  : "text-editor-muted hover:bg-white/6 hover:text-editor-fg",
              )}
              // Pointer rather than mouse events, so a look previews under a
              // trackpad hover and a pen alike. Cleared on leave rather than on
              // the next row's enter: the rows have a gap between them, and a
              // pointer resting in it would otherwise hold the last row's look
              // on the picture indefinitely.
              onPointerEnter={() => onPreview?.(look.id)}
              onPointerLeave={() => onPreview?.(null)}
              onClick={() => {
                onChange(look.id);
                close();
              }}
            >
              <LookThumb look={look.id} />
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="text-[13px]">{look.label}</span>
                {/* The room it is for, not what it does to the numbers. Nobody
                    picks a grade by its temperature in kelvin; they pick it
                    because there is a window behind them. */}
                <span className="text-[11px] text-editor-muted">{look.note}</span>
              </span>
            </button>
          ))}
        </div>
      </PushedView>
    </div>
  );
}
