import { useEffect, useRef } from "react";

import { CURSOR_STYLES, cursorStyle, cursorSwatch, cursorTag } from "../../../../shared/contract";
import { cn } from "../../lib/cn";
import { ChevronRightIcon } from "../icons";
import { CONTROL_H } from "./inputs";
import { PushedView, usePushed } from "./PushedView";

/**
 * The pointer, as a grid of the pointers themselves, in a list that takes the
 * panel over.
 *
 * Three names in a segmented control asked the reader to know what "Circle"
 * looks like before picking it. The artwork is the answer to that question and
 * it is already on disk — the same PNG the preview and the exporter composite,
 * so a swatch cannot come to show a pointer the recording will not get.
 *
 * **A grid rather than the labelled rows the camera shapes use**, and that is
 * not a style choice. A shape list needs its words — "No background" is not a
 * glyph, and a polaroid at sixteen pixels is a smudge. A pointer is the
 * opposite case: the picture is the only useful caption it has, and the names
 * are the part that does not help. "Black" beside "Classic Black" says nothing
 * the two pictures do not say at a glance. So: five across, no captions, the
 * name on `title` and `aria-label` — which is the accessible name once there
 * is no text, not a nicety.
 *
 * **Pushed rather than inline**, because there are twenty-five of them. Five
 * rows of tiles in the flow is the tallest thing in the panel, and it put the
 * name box and the mark's colour and size — the controls that actually get
 * dialled — below the fold on a set-once catalogue.
 *
 * **Hovering a tile puts the pointer on the recording.** A twenty-pixel swatch
 * says which pointer it is and nothing about how it sits on this footage at
 * this size, which is the question being asked.
 *
 * A dark plate, which is a real trade. Every style carries an outline of the
 * opposite tone, so a black pointer on dark is legible as its white outline
 * rather than invisible — but it is legible as an *outline*, and black and
 * white are further apart on a mid grey than they are here. Dark wins anyway
 * because the swatch then shows the pointer against something like what it will
 * actually be composited over, and most of the styles are light.
 */
export function CursorPicker({
  value,
  imageUrl,
  disabled,
  onChange,
  onPreview,
}: {
  value: string;
  /** Turns a style's file name into something the renderer can load. */
  imageUrl: (file: string) => string;
  disabled?: boolean;
  onChange: (id: string) => void;
  /** The style to draw instead of the chosen one while a tile is hovered. */
  onPreview?: (id: string | null) => void;
}) {
  const { open, toggle, close } = usePushed("Pointer");

  /**
   * Dropping the preview when the grid goes away.
   *
   * Verbatim from `CameraShapePicker`, and for the reason spelled out there: a
   * tile's `onPointerLeave` covers the pointer moving off it, but not the two
   * ways the grid stops existing under a pointer that never moved — the click
   * that chooses, and the back arrow. Either would leave a hovered style
   * standing in for the project's with nothing on screen to say so.
   */
  const preview = useRef(onPreview);
  preview.current = onPreview;
  useEffect(() => () => preview.current?.(null), [open]);

  /**
   * A control that cannot be used cannot keep the panel.
   *
   * `PushedView` draws nothing while disabled and the inspector hides its body
   * whenever anything is pushed, so the two together are exactly the empty
   * body `PushedView`'s own note warns about — a header and a back arrow over
   * nothing. Reachable: open this, then select a clip that switches the thing
   * off. The control stays mounted across that, so the unmount cleanup there
   * does not fire.
   */
  useEffect(() => {
    if (disabled && open) close();
  }, [disabled, open, close]);

  const chosen = cursorStyle(value);

  return (
    <div className={cn("flex flex-col", disabled && "pointer-events-none opacity-40")}>
      {/* The swatch, not just the name. "Black" and "Classic Black" are
          indistinguishable as words and obvious as pictures, which is the whole
          reason the list below has no captions — a trigger showing only the
          label would be the one place in this control that says the useless
          half. */}
      <button
        type="button"
        // Named by attribute for the documentation screenshots, which have to
        // open this before they can reach a tile — the same convention as
        // `data-panel`. The visible label is the style's name, so a shot
        // matching on text would be matching on whichever pointer happened to
        // be chosen.
        data-control="cursor-style"
        aria-expanded={open}
        className={cn(
          "flex items-center justify-between gap-2 rounded-full bg-white/5 px-2.5 text-left",
          CONTROL_H,
          open && "bg-white/12",
        )}
        onClick={toggle}
      >
        <span className="flex min-w-0 items-center gap-2">
          <img
            src={imageUrl(cursorSwatch(chosen.id))}
            alt=""
            draggable={false}
            className="size-4 flex-none select-none object-contain"
          />
          <span className="truncate text-[13px] text-white">{chosen.label}</span>
        </span>
        <span className="flex-none text-editor-muted [&_svg]:size-3" aria-hidden>
          <ChevronRightIcon />
        </span>
      </button>

      <PushedView open={open && !disabled}>
        <div className="grid grid-cols-5 gap-1" role="radiogroup">
          {CURSOR_STYLES.map((style) => {
            // Every style but the circle ships a pointer per shape the recording
            // may have caught, so the tooltip has to say which of the two it is —
            // the swatch shows an arrow either way.
            const shapes = Object.keys(style.shapes).length;
            const base =
              shapes > 1
                ? `${style.label} pointer, following the shape the system was showing — a hand over a link, an I-beam in text, arrows on an edge`
                : `${style.label} marker, whatever the pointer was doing`;
            // What the T on the tile means, spelled out for the one place there is
            // room for words.
            const title = cursorTag(style.id) !== null ? `${base}. Can carry a name tag` : base;

            return (
              <button
                key={style.id}
                type="button"
                role="radio"
                title={title}
                aria-label={style.label}
                aria-checked={style.id === value}
                className={cn(
                  // The button is the plate now that there is no caption under it,
                  // rather than a wrapper around one — a padded button holding a
                  // square leaves the ring floating clear of the artwork it is
                  // meant to be selecting.
                  // The layout cards' surface: a hairline and a barely-there fill,
                  // rather than the darker plate these used to carry. The two grids
                  // sit two panels apart and are the same kind of thing — a set of
                  // cards, one of them chosen — so they should not be two different
                  // materials.
                  //
                  // `relative`, for the mark below.
                  "relative grid aspect-square place-items-center rounded-lg bg-white/5",
                  style.id === value ? "ring-2 ring-selected ring-inset" : "hover:bg-white/10",
                )}
                // Pointer rather than mouse events, so a style previews under a
                // trackpad hover and a pen alike. Cleared on leave rather than
                // on the next tile's enter: the tiles have a gap between them,
                // and a pointer resting in it would otherwise hold the last
                // one's style on the recording indefinitely.
                onPointerEnter={() => onPreview?.(style.id)}
                onPointerLeave={() => onPreview?.(null)}
                // Closed on the choice, which is the opposite of what a popover
                // would want and right for a takeover: picking a style can also
                // write a mark, a sound and a name — see the panel — and those
                // rows are on the panel this is covering. Leaving it open would
                // mean every one of those changes happening out of sight.
                onClick={() => {
                  onChange(style.id);
                  close();
                }}
              >
                {/* Half the plate rather than the two fifths this was. The swatches
                    are five across where they were three, so the same fraction of a
                    smaller plate left the glyph too small to tell an arrow from a
                    circle. */}
                {/* The style's own tile where it has one, which is the stick: its
                    sprite is almost all handle, and half a plate of it would be a
                    hairline across an empty square. See `cursorSwatch`. */}
                <img
                  src={imageUrl(cursorSwatch(style.id))}
                  alt=""
                  draggable={false}
                  className="w-1/2 select-none"
                />

                {/* A T on the ones that carry a name tag.
                    Which styles those are is not guessable from the artwork — the
                    tag is drawn beside the pointer in the composition, not on the
                    swatch — so picking one was the only way to find out, and the
                    field that appears underneath was the only thing that said so.
                    A mark on the tile answers it before the press.
                    Not a letter in a circle or a badge with a fill: five across,
                    this is forty points square, and anything with a surface of its
                    own at that size is a smudge. The glyph alone, in the corner the
                    eye already checks for a state.
                    `aria-hidden` and said properly in the title instead — a lone
                    "T" read out between two pointer names is noise. */}
                {cursorTag(style.id) !== null && (
                  <span
                    aria-hidden
                    className="absolute top-0.5 right-1.5 text-[10px] leading-none font-semibold text-white/55"
                  >
                    T
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PushedView>
    </div>
  );
}
