import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

import { cursorImages, type CursorLayer } from "../../../shared/contract";
import {
  buildRenderPlan,
  type EnterTransition,
  placement,
  type PlanSource,
  type Rect,
  type Size,
  type SourceSizes,
} from "../../../shared/layout";
import type { LayoutSettings, SliceSettings, ZoomSlice } from "../../../shared/project";
import { cn } from "../lib/cn";
import { isReady, WebGlCompositor, type Images, type Sources } from "./webgl";
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
/**
 * Grabs whatever the preview is showing, as a PNG data URL.
 *
 * Resolves null if the loop stops before the next frame — the caller has to be
 * able to carry on without a picture rather than wait forever for one.
 */
export type Grab = () => Promise<string | null>;

export function Preview({
  frame,
  settings,
  enter,
  media,
  images,
  cursor,
  zooms,
  grab: grabRef,
  onLayout,
}: {
  frame: Size;
  settings: SliceSettings;
  /**
   * The arrangement this slice is arriving from, or null on the first one.
   *
   * Passed rather than derived here: the plan is rebuilt every frame and the
   * previous slice's settings change only at a cut, so resolving them in the
   * loop would be work per frame for an answer that holds for a whole clip.
   */
  enter: EnterTransition | null;
  media: EditorPlayback;
  images: Images;
  /** The pointer track, or null when this recording has none to draw. */
  cursor: CursorLayer | null;
  /** Zoom spans, baked into the plan as a sampled crop. */
  zooms: readonly ZoomSlice[];
  /**
   * Filled in with a way to grab the current frame as a PNG data URL.
   *
   * A ref rather than a callback prop because the caller pulls: the export
   * dialog wants one frame when it opens, not a stream of them.
   */
  grab?: RefObject<Grab | null>;
  /**
   * Whatever a drag in the preview worked out, as layout keys.
   *
   * A patch rather than one callback per gesture: a resize writes five keys and
   * a detach writes six, and threading each of them out as its own prop would
   * put the knowledge of *which* keys a gesture touches in two places.
   */
  onLayout: (patch: Partial<LayoutSettings>) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const compositor = useRef(new WebGlCompositor());
  /** What is being dragged, and from where. Null between gestures. */
  const grab = useRef<Grip | null>(null);
  /** The selection ring. Positioned from the draw loop, never by React. */
  const outline = useRef<HTMLDivElement>(null);
  /** Waiting to be handed the next drawn frame, or null when nobody asked. */
  const wanted = useRef<((shot: string | null) => void) | null>(null);
  const [fitted, setFitted] = useState({ width: 0, height: 0 });
  /**
   * Which picture is ringed, or null when nothing is.
   *
   * Local to the preview. Nothing else in the editor acts on it, and a
   * selection held in the project would have to be cleared from every place
   * that can change the arrangement out from under it.
   */
  const [selected, setSelected] = useState<PlanSource | null>(null);

  // Read through refs so changing a setting does not restart the loop — the
  // next frame simply picks the new values up.
  const latest = useRef({ frame, settings, enter, images, fitted, selected });
  latest.current = { frame, settings, enter, images, fitted, selected };

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

    let handle = 0;

    // The rAF timestamp, not `performance.now()`: it is the frame's
    // presentation time and is evenly spaced, which is what keeps the pointer
    // moving in step with the picture it sits on.
    const render = (now: number) => {
      handle = requestAnimationFrame(render);

      const {
        frame: size,
        settings: current,
        enter: arriving,
        images: loaded,
        fitted: box,
        selected: ringed,
      } = latest.current;
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

      const sizes: SourceSizes = {
        screen: sources.screen ? { width: screen!.videoWidth, height: screen!.videoHeight } : null,
        camera: sources.camera ? { width: camera!.videoWidth, height: camera!.videoHeight } : null,
      };

      const plan = buildRenderPlan(
        size,
        sizes,
        current,
        cursor && {
          ...cursor,
          ...cursorImages(current.layout.cursorStyle),
          size: current.layout.cursorSize,
          hideAfter: current.layout.cursorAutoHide ? current.layout.cursorHideAfter : null,
        },
        zooms,
        arriving,
      );

      // Source time, because that is what the pointer track is indexed by —
      // the same clock the media elements are seeked on.
      const at = media.sourceAt(now) ?? 0;
      compositor.current.draw(element, plan, sources, loaded, backing, at);

      // The ring rides along with the picture from here rather than from a
      // render, for the reason the picture itself is drawn here: the box moves
      // with the sources' own dimensions and with a drag in flight, and React
      // is told about neither on the frame it happens.
      ring(outline.current, ringed, size, current, sizes, box, zooms, at);

      // Read here and nowhere else. The context is created without
      // `preserveDrawingBuffer`, so the drawing buffer is cleared as soon as
      // the browser composites the frame — `toDataURL` from an event handler or
      // an effect comes back fully transparent, with no error to say why.
      if (wanted.current) {
        const resolve = wanted.current;
        wanted.current = null;
        resolve(element.toDataURL("image/png"));
      }
    };

    handle = requestAnimationFrame(render);
    return () => cancelAnimationFrame(handle);
  }, [media]);

  useEffect(() => {
    if (!grabRef) return;

    grabRef.current = () => new Promise((resolve) => (wanted.current = resolve));

    return () => {
      grabRef.current = null;
      // Nobody is going to draw another frame for this request, and a promise
      // that never settles would leave the dialog waiting on a picture forever.
      wanted.current?.(null);
      wanted.current = null;
    };
  }, [grabRef]);

  // Released on unmount and *only* on unmount. The loop above re-runs on every
  // render — `useEditorPlayback` hands back a new object each time — so
  // disposing there tore the compositor down constantly, and it came back
  // without a shader. A blank preview, from a cleanup that read as tidy.
  useEffect(() => {
    const painter = compositor.current;
    return () => painter.dispose();
  }, []);

  // A camera switched off has no ring to draw, and switching it back on should
  // not restore a selection made before it was hidden — the user would come
  // back to handles on something they did not just click.
  useEffect(() => {
    if (selected === "camera" && !settings.layout.cameraVisible) setSelected(null);
  }, [selected, settings.layout.cameraVisible]);

  // Escape drops it, as it does everywhere else in the app something is
  // selected. On the window rather than the canvas: the ring stays up while the
  // panels beside it are being used, so the canvas rarely has focus.
  useEffect(() => {
    if (!selected) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

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

  /** The two sources' own dimensions, read off the elements the loop draws. */
  const sourceSizes = (): SourceSizes => {
    const screen = media.getElement("screen");
    const camera = media.getElement("camera");
    return {
      screen: isReady(screen) ? { width: screen!.videoWidth, height: screen!.videoHeight } : null,
      camera:
        media.visible.has("camera") && isReady(camera)
          ? { width: camera!.videoWidth, height: camera!.videoHeight }
          : null,
    };
  };

  /**
   * Where each picture is right now, as the plan has it.
   *
   * The camera is dropped when it is switched off, so a hidden bubble cannot be
   * picked up by something the user cannot see.
   */
  const pictures = () => {
    const sources = sourceSizes();
    const { layout, background } = settings;
    return {
      screen: placement(frame, layout, background, sources, "screen"),
      camera: layout.cameraVisible ? placement(frame, layout, background, sources, "camera") : null,
      sources,
    };
  };

  /** How many output pixels a point on screen is worth, for hit tolerances. */
  const grain = () => (fitted.width > 0 ? frame.width / fitted.width : 1);

  /** What is under the pointer: a corner to pull, a picture to drag, or nothing. */
  const find = (point: Point): Grip | null => {
    const near = HANDLE * grain();
    const { screen, camera } = pictures();

    // The camera first, because in every arrangement that stacks them it is the
    // one on top — and a bubble sitting over the screen would otherwise be
    // unreachable wherever the two overlap.
    for (const target of ["camera", "screen"] as const) {
      const found = target === "camera" ? camera : screen;
      if (!found) continue;

      // Only the ringed picture answers to its corners. The handles are what
      // say a corner is there, so a resize on a picture showing none is a
      // gesture nobody aimed — and on the stacked arrangements it is usually
      // the *other* picture's edge the pointer was heading for.
      const corner = target === selected ? cornerAt(found.dstRect, point, near) : null;
      if (corner) return { kind: "resize", target, corner, box: found.dstRect, from: point };
      if (inside(found.dstRect, point)) {
        return { kind: "move", target, box: found.dstRect, from: point };
      }
    }

    return null;
  };

  /** The keys one gesture writes, worked out from where the pointer has got to. */
  /**
   * Both boxes exactly where they are now, as `custom` would store them.
   *
   * Written whenever a drag falls out of an arrangement, so the picture that is
   * *not* being dragged stays where it was. Without it, resizing the screen out
   * of a split sent the camera back to the default bubble in the corner — a
   * jump nobody asked for, on the one gesture where the eye is on the other
   * picture waiting to see what happens to it.
   */
  const seeded = (): Partial<LayoutSettings> => {
    const unit = Math.min(frame.width, frame.height);
    const { screen, camera } = pictures();
    const patch: Partial<LayoutSettings> = {};

    if (screen) {
      patch.screenX = (screen.dstRect.x + screen.dstRect.width / 2) / frame.width;
      patch.screenY = (screen.dstRect.y + screen.dstRect.height / 2) / frame.height;
      patch.screenWidth = screen.dstRect.width / unit;
      patch.screenHeight = screen.dstRect.height / unit;
    }

    if (camera) {
      patch.cameraX = (camera.dstRect.x + camera.dstRect.width / 2) / frame.width;
      patch.cameraY = (camera.dstRect.y + camera.dstRect.height / 2) / frame.height;
      patch.cameraWidth = camera.dstRect.width / unit;
      patch.cameraHeight = camera.dstRect.height / unit;
      // Which dressing it had, so `custom` can keep it. Without this, dragging
      // the screen out of a split turned the camera beside it from a
      // square-cornered card into a round bubble — a change to the picture the
      // user was not touching.
      patch.cameraCard = camera.card;
    }

    return patch;
  };

  /** The keys one gesture writes, worked out from where the pointer has got to. */
  const patchFor = (grip: Grip, point: Point, aspect: boolean): Partial<LayoutSettings> => {
    const unit = Math.min(frame.width, frame.height);
    const { layout } = settings;

    if (grip.kind === "pan") {
      const found = grip.target === "screen" ? pictures().screen : pictures().camera;
      const source = sourceSizes()[grip.target];
      if (!found || !source) return {};

      // Under `cover` the picture travels with the pointer, so the crop window
      // travels against it — by as much of the source as the pointer covered of
      // the picture. `place` clamps the result, so a pan stops at the edge of
      // the recording rather than sampling nothing.
      //
      // Under `contain` there is no window: the whole source is on show, and
      // the offset slides the picture around inside the area it was given. Same
      // gesture, opposite sign, and the fraction is of the area rather than of
      // the source.
      const [dx, dy] =
        found.fit === "cover"
          ? [
              -((point.x - grip.from.x) / found.dstRect.width) *
                (found.srcRect.width / source.width),
              -((point.y - grip.from.y) / found.dstRect.height) *
                (found.srcRect.height / source.height),
            ]
          : [
              (point.x - grip.from.x) / Math.max(found.area.width, 1),
              (point.y - grip.from.y) / Math.max(found.area.height, 1),
            ];

      return grip.target === "screen"
        ? { screenOffsetX: grip.offsetX + dx, screenOffsetY: grip.offsetY + dy }
        : { cameraOffsetX: grip.offsetX + dx, cameraOffsetY: grip.offsetY + dy };
    }

    const box =
      grip.kind === "resize"
        ? pulled(grip.box, grip.corner, point, aspect)
        : {
            ...grip.box,
            x: grip.box.x + (point.x - grip.from.x),
            y: grip.box.y + (point.y - grip.from.y),
          };

    const centre = {
      x: (box.x + box.width / 2) / frame.width,
      y: (box.y + box.height / 2) / frame.height,
    };

    if (grip.target === "camera") {
      // The `over-*` arrangements and `custom` already leave the camera's box
      // to its own settings, so neither moving nor resizing it there is a
      // change of arrangement at all: write the box and leave the preset be.
      // Forcing `custom` on any resize also froze the *screen* box, which is
      // how pulling a corner of the bubble quietly disconnected the padding
      // slider from the picture beside it.
      //
      // Anywhere else the arrangement placed the camera. Moving it is a request
      // for the arrangement that does not — keeping whatever full-bleed or
      // padded look the screen already had, because that is not what was being
      // changed. Resizing it has no `over-*` answer, the camera being given a
      // shape of its own, which is what `custom` is for.
      const placed = detached(layout.preset) !== null;
      const loose = !placed ? null : grip.kind === "resize" ? "custom" : detached(layout.preset);
      const detaching = loose !== null && loose !== layout.preset;

      const patch: Partial<LayoutSettings> = {
        ...(detaching ? seeded() : {}),
        cameraX: centre.x,
        cameraY: centre.y,
      };

      if (grip.kind === "resize") {
        patch.cameraWidth = box.width / unit;
        patch.cameraHeight = box.height / unit;
      }
      if (detaching) {
        patch.preset = loose!;
        // `camera-*` ignores the toggle, so the camera may have been on screen
        // with it switched off. The arrangement it lands in respects it.
        patch.cameraVisible = true;
      }

      return patch;
    }

    // The screen has no free-standing arrangement to fall back on: every
    // arrangement that placed it owns its box, so moving or resizing it is
    // `custom` by definition.
    return {
      ...(layout.preset === "custom" ? {} : seeded()),
      preset: "custom",
      screenX: centre.x,
      screenY: centre.y,
      screenWidth: box.width / unit,
      screenHeight: box.height / unit,
    };
  };

  return (
    <div ref={box} className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden p-6">
      {/* Sized to the picture so the ring inside it can be placed in frame
          pixels scaled once, and so the handles hanging off its corners are not
          clipped by anything — this box has no overflow of its own. */}
      <div className="relative" style={{ width: fitted.width, height: fitted.height }}>
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
            const found = find(point);
            // Empty background drops the selection, the same click that would
            // drop it on a canvas anywhere else.
            setSelected(found?.target ?? null);
            if (!found) return;

            // Alt turns a drag on a picture into a pan of what it is showing. The
            // corners keep resizing either way — there is nothing else a corner
            // could sensibly mean.
            grab.current =
              event.altKey && found.kind === "move"
                ? {
                    kind: "pan",
                    target: found.target,
                    from: point,
                    offsetX:
                      found.target === "screen"
                        ? settings.layout.screenOffsetX
                        : settings.layout.cameraOffsetX,
                    offsetY:
                      found.target === "screen"
                        ? settings.layout.screenOffsetY
                        : settings.layout.cameraOffsetY,
                  }
                : found;

            // Captured, so a fast drag that leaves the canvas keeps moving the
            // picture instead of dropping it wherever the pointer crossed out.
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const point = framePoint(event);

            if (!grab.current) {
              // Written straight to the element: this fires far more often than a
              // render, and routing a cursor change through state would rebuild
              // the editor to change one CSS property.
              const found = find(point);
              event.currentTarget.style.cursor = !found
                ? ""
                : found.kind === "resize"
                  ? CORNER_CURSOR[found.corner]
                  : event.altKey
                    ? "move"
                    : "grab";
              return;
            }

            if (grab.current.kind === "move") event.currentTarget.style.cursor = "grabbing";
            onLayout(patchFor(grab.current, point, event.shiftKey));
          }}
          onPointerUp={(event) => {
            grab.current = null;
            event.currentTarget.style.cursor = "";
          }}
          onPointerLeave={(event) => {
            if (!grab.current) event.currentTarget.style.cursor = "";
          }}
        />

        {/* Drawn over the picture, never in it: the canvas is the composition
            and this is a note about it, so it must not reach the export or the
            grabbed poster frame. `pointer-events-none` leaves every gesture
            with the canvas underneath, which is where the hit testing that put
            the ring here lives — two things listening for a drag on the same
            corner is how a handle comes to disagree with what it moves. */}
        <div
          ref={outline}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 border border-selected"
          // Hidden inline rather than with `hidden`, because the loop below
          // shows it by writing `display` — and an inline property cleared
          // against a class that also sets `display: none` never comes back.
          // The first rAF is after the first paint, so without this the ring
          // spends a frame collapsed at the top left corner.
          style={{ display: "none" }}
        >
          {CORNERS.map((corner) => (
            <span
              key={corner}
              className={cn(
                // Centred on the corner rather than tucked inside it, so the
                // handle marks the point the drag actually pivots about.
                "absolute size-2 rounded-[2px] border border-selected bg-white shadow-sm",
                HANDLE_AT[corner],
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Puts the ring on the selected picture, or takes it away.
 *
 * Geometry through `placement`, which is what the drag reads too — a ring
 * derived some other way would be a second answer to "where is the camera", and
 * the handles would end up somewhere the picture is not.
 */
function ring(
  element: HTMLDivElement | null,
  selected: PlanSource | null,
  frame: Size,
  settings: SliceSettings,
  sources: SourceSizes,
  fitted: Size,
  zooms: readonly ZoomSlice[],
  at: number,
): void {
  if (!element) return;

  const found = selected
    ? placement(frame, settings.layout, settings.background, sources, selected)
    : null;

  // A zoom moves the screen on its own track, leaving the box a drag reads and
  // writes exactly where it was. Following the zoom would put handles on a
  // corner that cannot be grabbed; staying put would ring empty background. So
  // for the length of the span there is no ring, and the picture is left to be
  // watched rather than edited.
  const moving =
    selected === "screen" && zooms.some((zoom) => at >= zoom.source.start && at <= zoom.source.end);

  if (!found || moving || fitted.width <= 0) {
    element.style.display = "none";
    return;
  }

  const scale = fitted.width / frame.width;
  const { x, y, width, height } = found.dstRect;

  element.style.display = "block";
  // Transform rather than `left`/`top`: this runs every frame, and through a
  // drag it runs on every frame that also lays the canvas out.
  element.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
  element.style.width = `${width * scale}px`;
  element.style.height = `${height * scale}px`;
}

/** Clockwise from the top left, which is the order the handles read in. */
const CORNERS = ["nw", "ne", "se", "sw"] as const;

const HANDLE_AT: Record<Corner, string> = {
  nw: "-top-1 -left-1",
  ne: "-top-1 -right-1",
  se: "-right-1 -bottom-1",
  sw: "-bottom-1 -left-1",
};

/** A point in the output frame, in its own pixels. */
interface Point {
  x: number;
  y: number;
}

type Corner = "nw" | "ne" | "sw" | "se";

/**
 * A drag in progress.
 *
 * `box` and `from` are both captured at the moment of grabbing, so a gesture is
 * always measured against where it started rather than against the last frame.
 * Accumulating deltas instead lets rounding walk the picture away under a slow
 * drag, which reads as drift nobody can point at the cause of.
 */
type Grip =
  | { kind: "move"; target: PlanSource; box: Rect; from: Point }
  | { kind: "resize"; target: PlanSource; corner: Corner; box: Rect; from: Point }
  | { kind: "pan"; target: PlanSource; from: Point; offsetX: number; offsetY: number };

/** How close to a corner counts as grabbing it, in points on screen. */
const HANDLE = 12;

const CORNER_CURSOR: Record<Corner, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

function inside(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Which corner the pointer is on, if any.
 *
 * The tolerance reaches inwards as well as outwards, so a corner is grabbable
 * on a picture that runs to the edge of the frame and has no outside to speak
 * of. It also has to stay smaller than the picture: on a bubble a few
 * tolerances across, four handles would cover the whole thing and it could
 * never be dragged.
 */
function cornerAt(rect: Rect, point: Point, near: number): Corner | null {
  const reach = Math.min(near, rect.width / 3, rect.height / 3);
  const west = Math.abs(point.x - rect.x) <= reach;
  const east = Math.abs(point.x - (rect.x + rect.width)) <= reach;
  const north = Math.abs(point.y - rect.y) <= reach;
  const south = Math.abs(point.y - (rect.y + rect.height)) <= reach;

  if (north && west) return "nw";
  if (north && east) return "ne";
  if (south && west) return "sw";
  if (south && east) return "se";
  return null;
}

/**
 * A rectangle with one corner pulled to the pointer.
 *
 * The opposite corner is the anchor and does not move, which is what makes a
 * resize feel like dragging an edge rather than scaling about a centre. Kept a
 * pixel across at worst: a box collapsed to nothing has no corners left to grab
 * and could never be recovered.
 */
function pulled(rect: Rect, corner: Corner, point: Point, keepAspect: boolean): Rect {
  const anchor = {
    x: corner === "nw" || corner === "sw" ? rect.x + rect.width : rect.x,
    y: corner === "nw" || corner === "ne" ? rect.y + rect.height : rect.y,
  };

  let width = Math.max(1, Math.abs(point.x - anchor.x));
  let height = Math.max(1, Math.abs(point.y - anchor.y));

  if (keepAspect) {
    // The larger of the two, so the picture follows the pointer outwards rather
    // than being held back by whichever edge moved less.
    const scale = Math.max(width / rect.width, height / rect.height);
    width = rect.width * scale;
    height = rect.height * scale;
  }

  return {
    x: corner === "nw" || corner === "sw" ? anchor.x - width : anchor.x,
    y: corner === "nw" || corner === "ne" ? anchor.y - height : anchor.y,
    width,
    height,
  };
}

/**
 * The arrangement to fall into when the bubble is picked up, or null.
 *
 * The `over-*` arrangements already leave the camera free, so dragging inside
 * one changes nothing structural. Every other arrangement placed the bubble,
 * and moving it is a request to stop.
 */
function detached(preset: LayoutSettings["preset"]): LayoutSettings["preset"] | null {
  switch (preset) {
    case "over-full":
    case "over-padded":
    case "custom":
      return null;
    case "split":
    case "camera-full":
      return "over-full";
    default:
      return "over-padded";
  }
}
