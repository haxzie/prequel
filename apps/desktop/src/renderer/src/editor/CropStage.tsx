import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";

import type { Rect, Size } from "../../../shared/layout";
import { clampCrop } from "./boxes";
import { fitInside } from "./fit";
import { isCorner, pulled, type Handle } from "./handles";
import { cn } from "../lib/cn";

/**
 * The whole take, with the part of it that stays drawn over the top.
 *
 * Its own surface rather than a mode of the preview, and that is the feature:
 * cropping is a decision about the footage, so the composition — the
 * background, the padding, the bubble, the arrangement — is everything that
 * would make the decision harder to see. The board shows one picture at its own
 * proportions and a rectangle on it, and nothing else is reachable until Done or
 * Cancel. The project is not touched in the meantime: the crop lives here and
 * `cropPatch` writes it once, which is what lets Cancel cost nothing.
 *
 * The picture is drawn to a canvas rather than shown in a second `<video>`. The
 * element is already decoding for the compositor, and a second one on the same
 * file is a second decoder for the same frames — see the note on the hidden
 * media in `Editor`.
 */
export function CropStage({
  source,
  size,
  crop,
  onChange,
  mirrored,
  toolbar,
  headroom,
  footroom,
}: {
  /**
   * The element the frames come off, or null before it has opened.
   *
   * A `<video>` for a recording and an `<img>` for a screenshot, and this does
   * not care which: both are things `drawImage` accepts, and the only thing
   * asked of either is the picture it is showing now.
   */
  source: HTMLVideoElement | HTMLImageElement | null;
  /** The take's own dimensions, which is the space `crop` is measured in. */
  size: Size;
  /** The region that stays, in source pixels. */
  crop: Rect;
  onChange: (crop: Rect) => void;
  /**
   * Draw the take the way round the composition does.
   *
   * The camera is mirrored by default, and this surface has to agree with the
   * picture it is cropping or the rectangle lands on the other side of the
   * person's head. The crop it hands back is in what is *drawn*; `flipCrop`
   * turns that into the file's own coordinates on the way to a setting, which
   * is the caller's job because only the caller writes one.
   */
  mirrored?: boolean;
  /**
   * The crop's own bar, floated just above the take.
   *
   * Anchored to the picture rather than to the top of the window, exactly as
   * the composition's is — see `toolbar` in `Preview`. The two surfaces swap
   * places on the same board, and a bar that jumped to the ceiling as the crop
   * opened would read as a different window arriving.
   */
  toolbar?: ReactNode;
  /** How much of the top edge the title bar and the crop's own bar cover. */
  headroom?: string;
  /** The same, for the reading under the picture. */
  footroom?: string;
}) {
  const board = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<Size>({ width: 0, height: 0 });

  /**
   * The gesture in flight, or null.
   *
   * A ref and not state: the pointer handlers read and write it between frames,
   * and a drag that went through a state updater would act on where the pointer
   * was a render ago.
   */
  const drag = useRef<{ handle: Handle | null; from: Point; box: Rect } | null>(null);

  // Measured rather than left to percentages, for the reason the preview's
  // canvas is — see the note at the top of `Preview`. `contentRect` is the
  // padded box, so the gutter below is already off it.
  useLayoutEffect(() => {
    const element = board.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (rect) setRoom({ width: rect.width, height: rect.height });
    });
    observer.observe(element);

    const rect = element.getBoundingClientRect();
    setRoom({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  const fitted = fitInside(size, room);

  // Repainted from an animation frame rather than from a render: a video's
  // contents change without React being told, so a crop taken over a playing
  // recording would be drawn against one frozen frame.
  useEffect(() => {
    if (fitted.width <= 0 || fitted.height <= 0) return;

    let live = true;
    const draw = () => {
      if (!live) return;
      window.requestAnimationFrame(draw);

      const element = canvas.current;
      const context = element?.getContext("2d");
      if (!element || !context || !source) return;

      // Physical pixels, capped the same way the compositor's are: a Retina
      // panel wants two per point and beyond that nothing is visible.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(fitted.width * ratio);
      const height = Math.round(fitted.height * ratio);
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }

      context.clearRect(0, 0, width, height);
      context.save();
      // Flipped about the middle rather than drawn and then reflected: the
      // canvas is exactly the picture, so one transform is the whole of it.
      if (mirrored) {
        context.translate(width, 0);
        context.scale(-1, 1);
      }
      try {
        context.drawImage(source, 0, 0, width, height);
      } catch {
        // A frame that is not there yet. The next one usually is, and throwing
        // out of an animation frame would stop the loop for the whole session.
      }
      context.restore();
    };

    draw();
    return () => {
      live = false;
    };
  }, [source, mirrored, fitted.width, fitted.height]);

  /** Where the pointer is, in source pixels. */
  const pointAt = (event: PointerEvent<HTMLElement>): Point => {
    const rect = picture.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return { x: 0, y: 0 };

    return {
      x: ((event.clientX - rect.left) / rect.width) * size.width,
      y: ((event.clientY - rect.top) / rect.height) * size.height,
    };
  };

  const begin = (handle: Handle | null) => (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, from: pointAt(event), box: crop };
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const held = drag.current;
    if (!held) return;

    const point = pointAt(event);
    if (!held.handle) {
      onChange(
        clampCrop(
          {
            ...held.box,
            x: held.box.x + (point.x - held.from.x),
            y: held.box.y + (point.y - held.from.y),
          },
          size,
        ),
      );
      return;
    }

    // Free on a corner, unlike a resize of the picture itself — where a corner
    // is a statement about size and holds the proportions. A crop is a
    // statement about *shape*: the whole reason to pull a corner is to take a
    // square out of a wide take. Shift is the lock, which keeps one rule rather
    // than two — Shift means "keep the ratio" everywhere.
    onChange(clampCrop(pulled(held.box, held.handle, point, event.shiftKey), size));
  };

  const end = (event: PointerEvent<HTMLElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const scale = fitted.width > 0 ? fitted.width / size.width : 0;
  const window_ = {
    left: crop.x * scale,
    top: crop.y * scale,
    width: crop.width * scale,
    height: crop.height * scale,
  };

  return (
    <div
      ref={board}
      // The same gutter the composition has on every side, so the take sits
      // where the picture it replaced was rather than jumping outwards.
      className="relative grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden px-6"
      // Both added to the gutter rather than replacing it, so the take keeps
      // the same breathing room from the bars that the composition has.
      style={{ paddingTop: headroom ?? "1.5rem", paddingBottom: footroom ?? "1.5rem" }}
    >
      <div
        ref={picture}
        className="relative touch-none"
        style={{ width: fitted.width, height: fitted.height }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {toolbar && (
          <div
            // `inset-x-0` and a centring flex rather than `left-1/2` and a
            // translate: an absolutely positioned box is shrink-to-fit *within
            // what is left of its containing block*, so anchoring at the
            // halfway mark left the bar half the picture's width to lay out in
            // and the frame's size wrapped onto two lines. Spanning the box and
            // centring inside it gives the bar its whole width, and `flex-none`
            // lets it stay centred where it is wider than the picture.
            //
            // `pointer-events-none` on the strip and `auto` on the bar: the
            // strip covers the headroom above the picture, and without it the
            // invisible half of it would swallow presses meant for the board.
            className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-3 flex justify-center"
          >
            <span className="pointer-events-auto flex-none">{toolbar}</span>
          </div>
        )}

        <canvas
          ref={canvas}
          // `block` kills the inline baseline gap, which otherwise leaves a few
          // stray pixels under the canvas inside its grid cell.
          className="block rounded-lg bg-black/40"
          style={{ width: fitted.width, height: fitted.height }}
        />

        {/* Everything outside the crop, dimmed. One element with an enormous
            spread shadow rather than four panels around the window: four of
            them leave hairlines where they meet, and the seams move as the
            rectangle is dragged. The board's `overflow-hidden` is what keeps
            the spread on the stage. */}
        <div
          className={cn(
            "absolute cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.62)]",
            "outline outline-white/90",
          )}
          style={window_}
          onPointerDown={begin(null)}
        >
          {/* Thirds, which is what a crop is usually judged against. Hairlines
              at a tenth, so they guide without being part of the picture. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {[1, 2].map((third) => (
              <span
                key={`v${third}`}
                className="absolute top-0 bottom-0 w-px bg-white/10"
                style={{ left: `${(third / 3) * 100}%` }}
              />
            ))}
            {[1, 2].map((third) => (
              <span
                key={`h${third}`}
                className="absolute right-0 left-0 h-px bg-white/10"
                style={{ top: `${(third / 3) * 100}%` }}
              />
            ))}
          </div>

          {HANDLES.map((handle) => (
            <span
              key={handle}
              // Centred on the point the pull pivots about, like the preview's
              // own — see `HANDLE_AT` there. Larger than those: this is the
              // only thing on the board to grab, so there is no neighbouring
              // control for a generous target to swallow.
              className={cn(
                "absolute rounded-[3px] border border-black/30 bg-white shadow-sm",
                isCorner(handle) ? "size-3" : "size-2.5",
                AT[handle],
                CURSOR[handle],
              )}
              onPointerDown={begin(handle)}
            />
          ))}
        </div>

        {/* The reading, under the picture. In source pixels, because that is
            what the crop is measured in and what the numbers in the bar above
            are typed in — a second unit here would be a second answer to how
            big the crop is. */}
        <p className="absolute top-full left-1/2 mt-3 -translate-x-1/2 text-[11px] tabular-nums text-editor-muted">
          {Math.round(crop.width)} × {Math.round(crop.height)} of {size.width} × {size.height}
        </p>
      </div>
    </div>
  );
}

interface Point {
  x: number;
  y: number;
}

const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Where each handle sits on the window, centred on its own point. */
const AT: Record<Handle, string> = {
  nw: "-top-1.5 -left-1.5",
  n: "-top-1.25 left-1/2 -translate-x-1/2",
  ne: "-top-1.5 -right-1.5",
  e: "-right-1.25 top-1/2 -translate-y-1/2",
  se: "-right-1.5 -bottom-1.5",
  s: "-bottom-1.25 left-1/2 -translate-x-1/2",
  sw: "-bottom-1.5 -left-1.5",
  w: "-left-1.25 top-1/2 -translate-y-1/2",
};

const CURSOR: Record<Handle, string> = {
  nw: "cursor-nwse-resize",
  n: "cursor-ns-resize",
  ne: "cursor-nesw-resize",
  e: "cursor-ew-resize",
  se: "cursor-nwse-resize",
  s: "cursor-ns-resize",
  sw: "cursor-nesw-resize",
  w: "cursor-ew-resize",
};
