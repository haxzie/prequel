import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

import type { CursorLayer } from "../../../shared/contract";
import { buildRenderPlan, cameraRect, type Size } from "../../../shared/layout";
import type { SliceSettings, ZoomSlice } from "../../../shared/project";
import { isReady, PreviewCompositor, type Images, type Sources } from "./canvas";
import { fitInside } from "./fit";
import type { EditorPlayback } from "./useEditorPlayback";

/**
 * The composited frame.
 *
 * The canvas is sized to what is on screen, not to the output. Rendering a
 * 1080p plan into a 1080p buffer and letting CSS shrink it to a 900px pane
 * costs nearly five times the pixels for no visible gain, and eighteen times at
 * 4K — which is what made a preview with both screen and camera crawl. The plan
 * is in output coordinates, so the compositor scales once and draws it as-is;
 * geometry still comes from the same `buildRenderPlan` the exporter uses.
 *
 * Measured rather than left to `max-width: 100%` and `max-height: 100%`: a
 * percentage max-height resolves against the containing block, and through a
 * flex/grid chain that height is often indefinite — so the constraint silently
 * becomes `none` and the canvas lays out at its intrinsic size, which is the
 * full output resolution. At 1080p or 4K that is far taller than the window,
 * and the overflow is clipped off the bottom.
 *
 * Redrawn from its own animation frame rather than from React. The sources are
 * video elements whose contents change without anything telling React they
 * have, so a render-driven canvas would show a frozen frame between state
 * changes.
 */
export function Preview({
  frame,
  settings,
  media,
  images,
  cursor,
  cameraSource,
  zooms,
  onMoveCamera,
}: {
  frame: Size;
  settings: SliceSettings;
  media: EditorPlayback;
  images: Images;
  /** The pointer track, or null when this recording has none to draw. */
  cursor: CursorLayer | null;
  /** The camera's own dimensions, which the `wide` shape is proportioned to. */
  cameraSource: Size | null;
  /** Zoom spans, baked into the plan as a sampled crop. */
  zooms: readonly ZoomSlice[];
  /** Dragging the bubble. Both are fractions of the frame, at its centre. */
  onMoveCamera: (x: number, y: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const compositor = useRef(new PreviewCompositor());
  /** Offset from the bubble's centre to where it was picked up, or null. */
  const grab = useRef<{ x: number; y: number } | null>(null);
  const [fitted, setFitted] = useState({ width: 0, height: 0 });

  // Read through refs so changing a setting does not restart the loop — the
  // next frame simply picks the new values up.
  const latest = useRef({ frame, settings, images, fitted });
  latest.current = { frame, settings, images, fitted };

  // Fits the frame's aspect ratio into whatever space the window is giving
  // this pane, at any output size. `contentRect` is the padded box, so the
  // result already has the surrounding gutter taken out of it.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;

    const measure = (width: number, height: number) => {
      setFitted(fitInside(frame, { width, height }));
    };

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (rect) measure(rect.width, rect.height);
    });
    observer.observe(element);

    // The observer fires on its own, but not before the first paint — without
    // this the preview is zero-sized for a frame.
    const rect = element.getBoundingClientRect();
    measure(rect.width, rect.height);

    return () => observer.disconnect();
  }, [frame.width, frame.height]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const context = element.getContext("2d", { alpha: false });
    if (!context) return;

    let handle = 0;

    // The rAF timestamp, not `performance.now()`: it is the frame's
    // presentation time and is evenly spaced, which is what keeps the pointer
    // moving in step with the picture it sits on.
    const render = (now: number) => {
      handle = requestAnimationFrame(render);

      const { frame: size, settings: current, images: loaded, fitted: box } = latest.current;
      const screen = media.getElement("screen");
      const camera = media.getElement("camera");

      if (box.width <= 0 || box.height <= 0) return;

      // Physical pixels, capped: a Retina panel wants two per point, and beyond
      // that the extra resolution is invisible and the cost is not.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const backing = {
        width: Math.round(box.width * ratio),
        height: Math.round(box.height * ratio),
      };

      if (element.width !== backing.width) element.width = backing.width;
      if (element.height !== backing.height) element.height = backing.height;

      const sources: Sources = {
        screen: isReady(screen) ? screen : null,
        // Two separate reasons there may be nothing to draw, and both mean the
        // same thing here: the frame does not exist yet, so it is not invented.
        camera: media.visible.has("camera") && isReady(camera) ? camera : null,
      };

      const plan = buildRenderPlan(
        size,
        {
          screen: sources.screen
            ? { width: screen!.videoWidth, height: screen!.videoHeight }
            : null,
          camera: sources.camera
            ? { width: camera!.videoWidth, height: camera!.videoHeight }
            : null,
        },
        current,
        cursor && {
          ...cursor,
          size: current.layout.cursorSize,
          hideAfter: current.layout.cursorAutoHide ? current.layout.cursorHideAfter : null,
        },
        zooms,
      );

      // Source time, because that is what the pointer track is indexed by —
      // the same clock the media elements are seeked on.
      compositor.current.draw(context, plan, sources, loaded, backing, media.sourceAt(now) ?? 0);
    };

    handle = requestAnimationFrame(render);
    return () => cancelAnimationFrame(handle);
  }, [media]);

  /**
   * Where a pointer is in the output frame, in its own pixels.
   *
   * Through the element's measured rectangle rather than `fitted`: the two
   * agree, but only one of them is what the user actually clicked on.
   */
  const framePoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * frame.width,
      y: ((event.clientY - rect.top) / rect.height) * frame.height,
    };
  };

  const overCamera = (point: { x: number; y: number }) => {
    if (!settings.layout.cameraVisible || !media.visible.has("camera")) return false;

    const box = cameraRect(frame, settings.layout, cameraSource);
    return (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    );
  };

  return (
    <div
      ref={box}
      className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden bg-black/40 p-6"
    >
      <canvas
        ref={canvas}
        // `block` kills the inline baseline gap, which otherwise leaves a few
        // stray pixels under the canvas inside its grid cell.
        className="block rounded-lg shadow-2xl"
        // Explicit pixels rather than a percentage: see the note above on why
        // `max-h-full` cannot be relied on here.
        style={{ width: fitted.width, height: fitted.height }}
        onPointerDown={(event) => {
          const point = framePoint(event);
          if (!overCamera(point)) return;

          // The grab offset, so the bubble does not jump its centre under the
          // pointer the instant it is picked up.
          const box = cameraRect(frame, settings.layout, cameraSource);
          grab.current = {
            x: point.x - (box.x + box.width / 2),
            y: point.y - (box.y + box.height / 2),
          };
          // Captured, so a fast drag that leaves the canvas keeps moving the
          // bubble instead of dropping it wherever the pointer crossed out.
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const point = framePoint(event);

          if (!grab.current) {
            // Written straight to the element: this fires far more often than a
            // render, and routing a cursor change through state would rebuild
            // the editor to change one CSS property.
            event.currentTarget.style.cursor = overCamera(point) ? "grab" : "";
            return;
          }

          event.currentTarget.style.cursor = "grabbing";
          onMoveCamera(
            (point.x - grab.current.x) / frame.width,
            (point.y - grab.current.y) / frame.height,
          );
        }}
        onPointerUp={(event) => {
          grab.current = null;
          event.currentTarget.style.cursor = "";
        }}
        onPointerLeave={(event) => {
          if (!grab.current) event.currentTarget.style.cursor = "";
        }}
      />
    </div>
  );
}
