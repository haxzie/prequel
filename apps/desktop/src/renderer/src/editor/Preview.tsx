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
  captionAt,
  type EnterTransition,
  placement,
  type PlanSource,
  type Rect,
  type RenderedCue,
  type RenderPlan,
  type Size,
  type SourceSizes,
} from "../../../shared/layout";
import {
  captionLook,
  type LayoutSettings,
  type WatermarkSettings,
  type SliceSettings,
  type ZoomSlice,
} from "../../../shared/project";
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

/**
 * What a click in the preview landed on.
 *
 * `PlanSource` and one more. A caption is not a picture — it has no box to drag
 * and no corners to pull — but it is a thing on screen with a panel behind it,
 * which is the only sense in which this list is about all three.
 */
export type Picked = Grabbable | "captions";

/**
 * What a drag in the preview can take hold of.
 *
 * `PlanSource` and the logo. Deliberately wider than `PlanSource`, which names
 * the two *video* textures — a watermark is a still file, and the only thing it
 * shares with them is that it has a box somebody can move.
 */
export type Grabbable = PlanSource | "watermark";

export function Preview({
  ready,
  frame,
  settings,
  enter,
  media,
  images,
  cursor,
  zooms,
  cues,
  grab: grabRef,
  onPick,
  onDrag,
}: {
  /**
   * Whether everything this draws with has arrived.
   *
   * The canvas paints regardless — it has to, so the frame revealed is a
   * finished one rather than the first of a fresh run — but it is held back
   * from view until this is true. What it drew before that was a background
   * with the recording missing from it, for as long as the first video frame
   * took to decode.
   */
  ready: boolean;
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
   * Cues that have already been laid out and rasterised, by look.
   *
   * Bitmaps rather than text, because the export gets the same ones: laying a
   * line out here and again in the exporter is the mistake this whole module
   * exists to prevent. Keyed by look because caption settings are per clip, so
   * the set drawn for one clip's style is not the set another wants.
   */
  cues: ReadonlyMap<string, readonly RenderedCue[]>;
  /**
   * Filled in with a way to grab the current frame as a PNG data URL.
   *
   * A ref rather than a callback prop because the caller pulls: the export
   * dialog wants one frame when it opens, not a stream of them.
   */
  grab?: RefObject<Grab | null>;
  /**
   * A picture was clicked, so the inspector can show the panel that dresses it.
   *
   * Only ever called with one — deliberately not on a deselect. Clicking the
   * background is how a ring is taken off, and changing which panel is showing
   * on that click would mean losing your place every time you dismissed a
   * selection.
   *
   * A callback rather than lifting `selected` out. Nothing else in the editor
   * acts on which picture is ringed, and a selection held outside would have to
   * be cleared from every place that can change the arrangement out from under
   * it — the note on `selected` says so, and it is still true.
   */
  onPick?: (target: Picked) => void;
  /**
   * Whatever a drag in the preview worked out, and which section it belongs to.
   *
   * A patch rather than one callback per gesture: a resize writes five keys and
   * a detach writes six, and threading each of them out as its own prop would
   * put the knowledge of *which* keys a gesture touches in two places.
   *
   * The section travels with it because a drag can now move the logo, whose
   * settings are their own section — and the caller writes one key at a time,
   * so it has to be told where each one goes.
   */
  onDrag: (section: "layout" | "watermark", patch: Record<string, unknown>) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const compositor = useRef(new WebGlCompositor());
  /** What is being dragged, and from where. Null between gestures. */
  const grab = useRef<Grip | null>(null);
  /** The canvas's box, held while the pointer is on it. See `framePoint`. */
  const canvasBox = useRef<DOMRect | null>(null);
  /** The selection ring. Positioned from the draw loop, never by React. */
  const outline = useRef<HTMLDivElement>(null);
  /**
   * The alignment guides, shown only while a drag is on one.
   *
   * Written straight to the DOM like the ring above, and for the same reason:
   * this changes on every pointer move, and routing it through state would
   * rebuild the editor to move a one-pixel line.
   */
  const guideX = useRef<HTMLDivElement>(null);
  const guideY = useRef<HTMLDivElement>(null);
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
  const [selected, setSelected] = useState<Grabbable | null>(null);

  // Read through refs so changing a setting does not restart the loop — the
  // next frame simply picks the new values up.
  /**
   * The last plan built, and the inputs it was built from.
   *
   * `buildRenderPlan` was called on every frame, and none of what it reads
   * changes between frames: the plan is the whole composition in output pixels,
   * and *when* to sample it is `at`, which the compositor applies afterwards.
   * So sixty times a second it re-smoothed the entire pointer track — the
   * spring is resampled across every sample in the recording — and rebuilt the
   * same seven items from it. Linear in the length of the take, which is the
   * wrong shape for a per-frame cost even where it is small.
   *
   * Cached here rather than in a `useMemo` because two of its inputs are read
   * off the video elements inside the loop, not from a render.
   */
  const cached = useRef<{ key: readonly unknown[]; plan: RenderPlan } | null>(null);

  /**
   * The last set of cue bitmaps that was actually drawn for.
   *
   * A change of font, style or line budget is a new look, and a look has no
   * bitmaps until they have been rasterised — a few hundred milliseconds on a
   * long recording. Until then there is nothing under the new key, and the
   * captions came off the preview entirely: a font picked from the list blanked
   * them, then they reappeared, which reads as the control having broken
   * something rather than having changed it. So the previous set stands in.
   *
   * Only ever a stand-in. The bitmaps behind it are swept the moment the new
   * set is published, and by then this is no longer being read.
   */
  const stale = useRef<readonly RenderedCue[] | undefined>(undefined);

  // `cursor`, `zooms` and `cues` are in here for the same reason as the rest,
  // and it took a regression to notice they were not. The loop's effect depends
  // on `media`, which used to be a fresh object on every render — so the closure
  // was rebuilt constantly and read those three straight from props without ever
  // going stale. Memoising `media` made the closure live as long as the
  // component, and a tilt dragged on a zoom stopped reaching the preview: the
  // plan was still being rebuilt, from the `zooms` the closure had captured on
  // the render it was created. Anything the loop reads goes through here.
  const latest = useRef({ frame, settings, enter, images, fitted, selected, cursor, zooms, cues });
  latest.current = { frame, settings, enter, images, fitted, selected, cursor, zooms, cues };

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
        cursor: pointer,
        zooms: shots,
        cues: drawn,
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

      // Every one of these is stable between frames — the settings and the
      // tracks are memoised upstream, and the two sizes only change when a
      // source loads or the camera is switched off. Compared by identity, so a
      // real edit misses and lands a new plan on the very next frame.
      const fresh = drawn.get(captionLook(current.captions));
      const shown = fresh ?? stale.current;
      if (fresh) stale.current = fresh;
      const key = [
        size,
        sizes.screen?.width,
        sizes.screen?.height,
        sizes.camera?.width,
        sizes.camera?.height,
        current,
        pointer,
        shots,
        arriving,
        shown,
      ] as const;

      const previous = cached.current;
      const plan =
        previous && previous.key.length === key.length && previous.key.every((v, i) => v === key[i])
          ? previous.plan
          : buildRenderPlan(
              size,
              sizes,
              current,
              pointer && {
                ...pointer,
                ...cursorImages(current.layout.cursorStyle),
                size: current.layout.cursorSize,
                hideAfter: current.layout.cursorAutoHide ? current.layout.cursorHideAfter : null,
                // Resolved here rather than in the plan, like `hideAfter`: a
                // track with no spans and one the user asked to keep the
                // pointer through are the same thing to draw.
                keys: current.layout.cursorHideWhileTyping ? pointer.keys : [],
              },
              shots,
              arriving,
              // The set drawn for *this* clip's look. A clip whose captions are
              // off has no look and gets nothing, which draws nothing.
              shown,
            );

      if (plan !== previous?.plan) cached.current = { key, plan };

      // Source time, because that is what the pointer track is indexed by —
      // the same clock the media elements are seeked on.
      const at = media.sourceAt(now) ?? 0;
      compositor.current.draw(element, plan, sources, loaded, backing, at);

      // The ring rides along with the picture from here rather than from a
      // render, for the reason the picture itself is drawn here: the box moves
      // with the sources' own dimensions and with a drag in flight, and React
      // is told about neither on the frame it happens.
      ring(outline.current, ringed, size, current, sizes, box, shots, at);

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

  /**
   * A click anywhere else takes the ring off.
   *
   * The dotted surround already deselects, but it is only the box around the
   * composition — clicking the inspector, the timeline or the frame bar left a
   * picture ringed and handled while the panel beside it had moved on to
   * something else. A selection is a statement about what the *next* gesture
   * acts on, so anything that is plainly a different gesture should end it.
   *
   * On `pointerdown` rather than `click`, so it lands in the same phase the
   * canvas selects in and a press that starts a drag elsewhere does not leave
   * the ring up for the length of it. Anything inside the preview box is left
   * alone: the canvas has its own hit testing, and this must not race it.
   */
  useEffect(() => {
    // `Event`, not `PointerEvent`: React's own `PointerEvent` type is in scope
    // here and is not the DOM one, and only the target is read either way.
    const away = (event: Event) => {
      const within = box.current;
      if (!within || within.contains(event.target as Node)) return;
      setSelected(null);
    };

    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

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

  // Released on unmount and *only* on unmount. Disposing inside the draw loop's
  // effect tore the compositor down and rebuilt it without a shader — a blank
  // preview, from a cleanup that read as tidy. `media` is memoised now, so the
  // loop re-runs far less often than it did, but "far less often" is still not
  // "on unmount": the compositor outlives every restart of the loop that uses
  // it.
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
    // Measured on entry and on press rather than here. This runs on every
    // `pointermove` across the picture — not only during a drag, because a
    // hover has to decide which cursor to show — and on top of the rectangle it
    // resolves the layout twice through `find`. The canvas cannot move under a
    // pointer that is already on it: it is sized in an effect, and the window
    // behind it does not scroll.
    const rect = canvasBox.current ?? event.currentTarget.getBoundingClientRect();
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

  /**
   * The logo's box, or null when there is none.
   *
   * Worked out here rather than read off the plan, and it is the same
   * arithmetic `buildRenderPlan` does — which is a duplication worth naming.
   * The plan is built inside the draw loop from a ref, so it is a frame behind
   * whatever the pointer is doing; hit testing against it would grab the box
   * the logo was in rather than the one it is in. The two boxes are two lines
   * of the same multiplication, and `layout.test.ts` pins the plan's.
   */
  const watermarkBox = (): Rect | null => watermarkRect(frame, settings.watermark);

  /** How many output pixels a point on screen is worth, for hit tolerances. */
  const grain = () => (fitted.width > 0 ? frame.width / fitted.width : 1);

  /**
   * Whether a caption is under the pointer.
   *
   * Its own test rather than a case in `find` below, because what comes back
   * from that is a *grip* — something to drag — and a caption is neither
   * dragged nor resized. All this answers is whether one was clicked.
   *
   * Off the plan that was last drawn, at the time it was drawn for: a cue is
   * only there for its own span, and `captionAt` is the one place that decides
   * whether it is on screen — the same function the compositor asks. Hit
   * testing against the item's box alone would catch every cue in the
   * recording, everywhere its text happens to sit.
   */
  const captionUnder = (point: Point): boolean => {
    const plan = cached.current?.plan;
    if (!plan) return false;

    const at = media.sourceAt() ?? 0;

    return plan.items.some(
      (item) => item.kind === "caption" && inside(captionAt(item, at)?.dst ?? EMPTY, point),
    );
  };

  /**
   * Puts the caught guides on screen, in the preview's own pixels.
   *
   * Output pixels divided by `grain()`, which is what one screen pixel is worth
   * — the same conversion the hit tolerances use, in the other direction.
   */
  const showGuides = (): void => {
    const scale = grain();

    const place = (element: HTMLDivElement | null, at: number | null, axis: "left" | "top") => {
      if (!element) return;
      if (at === null) {
        element.style.display = "none";
        return;
      }
      element.style.display = "block";
      element.style[axis] = `${String(at / scale)}px`;
    };

    place(guideX.current, caught.current.x, "left");
    place(guideY.current, caught.current.y, "top");
  };

  const hideGuides = (): void => {
    caught.current = { x: null, y: null };
    if (guideX.current) guideX.current.style.display = "none";
    if (guideY.current) guideY.current.style.display = "none";
  };

  /** What is under the pointer: a corner to pull, a picture to drag, or nothing. */
  const find = (point: Point): Grip | null => {
    const near = HANDLE * grain();
    const { screen, camera } = pictures();

    // The logo first: it is drawn over both pictures, so a mark sitting on the
    // bubble would otherwise be unreachable wherever the two overlap — the same
    // reason the camera comes before the screen below.
    const mark = watermarkBox();
    if (mark) {
      const corner = selected === "watermark" ? cornerAt(mark, point, near) : null;
      if (corner) return { kind: "resize", target: "watermark", corner, box: mark, from: point };
      if (inside(mark, point)) return { kind: "move", target: "watermark", box: mark, from: point };
    }

    // The camera next, because in every arrangement that stacks them it is the
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
  /**
   * The lines a dragged picture lines up against, in output pixels.
   *
   * The frame's middle for both pictures, because centring is the one
   * arrangement you can be sure somebody meant. The camera also gets the four
   * inset lines, which together read as the corner grid — a bubble is parked in
   * a corner far more often than it is put anywhere in particular, and finding
   * the same corner twice by eye is what this saves.
   *
   * The screen deliberately has no inset lines. Its edges are what `padding`
   * already sets, and a drag that snapped to them would fight the slider.
   */
  const guides = (target: Grabbable): { xs: number[]; ys: number[] } => {
    const unit = Math.min(frame.width, frame.height);
    const middle = { xs: [frame.width / 2], ys: [frame.height / 2] };
    if (target === "screen") return middle;

    const inset = Math.max(settings.background.padding, GUIDE_INSET) * unit;
    return {
      xs: [inset, ...middle.xs, frame.width - inset],
      ys: [inset, ...middle.ys, frame.height - inset],
    };
  };

  /**
   * The box, pulled onto whichever guides it came close to.
   *
   * Each axis is tried against the box's near edge, its middle and its far edge,
   * and the smallest pull within reach wins — so a bubble snaps by whichever of
   * its own edges is nearest a line, which is what makes a corner catch on both
   * axes at once.
   *
   * Answers with the lines it caught as well as the box, because the same
   * gesture has to draw them.
   */
  const pullToGuides = (
    box: Rect,
    target: Grabbable,
  ): { box: Rect; hitX: number | null; hitY: number | null } => {
    const near = SNAP * grain();
    const { xs, ys } = guides(target);

    const pull = (start: number, length: number, lines: number[]) => {
      let best: { delta: number; line: number } | null = null;

      for (const at of [start, start + length / 2, start + length]) {
        for (const line of lines) {
          const delta = line - at;
          if (Math.abs(delta) > near) continue;
          if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, line };
        }
      }

      return best;
    };

    const x = pull(box.x, box.width, xs);
    const y = pull(box.y, box.height, ys);

    return {
      box: { ...box, x: box.x + (x?.delta ?? 0), y: box.y + (y?.delta ?? 0) },
      hitX: x?.line ?? null,
      hitY: y?.line ?? null,
    };
  };

  /**
   * The lines the last move caught, for the pointer handler to draw.
   *
   * A ref rather than a return value because `patchFor` answers with a settings
   * patch and nothing else — and rather than state because this is read on the
   * same tick it is written, inside one synchronous handler, where a render
   * would be a round trip for something already known.
   */
  const caught = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

  const patchFor = (
    grip: Grip,
    point: Point,
    aspect: boolean,
  ): { section: "layout" | "watermark"; patch: Record<string, unknown> } => {
    const unit = Math.min(frame.width, frame.height);
    const { layout } = settings;

    if (grip.kind === "pan") {
      const found = grip.target === "screen" ? pictures().screen : pictures().camera;
      const source = sourceSizes()[grip.target];
      if (!found || !source) return { section: "layout", patch: {} };

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

      return {
        section: "layout",
        patch:
          grip.target === "screen"
            ? { screenOffsetX: grip.offsetX + dx, screenOffsetY: grip.offsetY + dy }
            : { cameraOffsetX: grip.offsetX + dx, cameraOffsetY: grip.offsetY + dy },
      };
    }

    // Only a move is snapped. A resize is a statement about size, and pulling
    // a corner onto a line would change the *other* edge to get there — the
    // picture would grow as you tried to place it.
    const dragged =
      grip.kind === "resize"
        ? { box: pulled(grip.box, grip.corner, point, aspect), hitX: null, hitY: null }
        : pullToGuides(
            {
              ...grip.box,
              x: grip.box.x + (point.x - grip.from.x),
              y: grip.box.y + (point.y - grip.from.y),
            },
            grip.target,
          );

    caught.current = { x: dragged.hitX, y: dragged.hitY };
    const box = dragged.box;

    const centre = {
      x: (box.x + box.width / 2) / frame.width,
      y: (box.y + box.height / 2) / frame.height,
    };

    if (grip.target === "watermark") {
      // Nothing to seed and no arrangement to fall out of: the logo is placed
      // by its own four numbers in every composition, so a drag writes them and
      // there is nothing else to keep in step.
      const patch: Partial<WatermarkSettings> = {
        watermarkX: centre.x,
        watermarkY: centre.y,
      };

      if (grip.kind === "resize") {
        patch.watermarkWidth = box.width / unit;
        patch.watermarkHeight = box.height / unit;
      }

      return { section: "watermark", patch };
    }

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

      return { section: "layout", patch };
    }

    // The screen has no free-standing arrangement to fall back on: every
    // arrangement that placed it owns its box, so moving or resizing it is
    // `custom` by definition.
    return {
      section: "layout",
      patch: {
        ...(layout.preset === "custom" ? {} : seeded()),
        preset: "custom",
        screenX: centre.x,
        screenY: centre.y,
        screenWidth: box.width / unit,
        screenHeight: box.height / unit,
      },
    };
  };

  return (
    <div
      ref={box}
      className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden p-6"
      // The dotted surround. A click that lands out here is the same "nothing"
      // the canvas already treats as a deselect, and without it a ring put on
      // the camera could only be taken off by finding an empty patch of the
      // composition itself — which a full-bleed arrangement does not have.
      //
      // `currentTarget` only. The picture, the ring and the handles all sit in
      // the box below this one, so anything with a target of its own is left to
      // the canvas, where the hit testing lives.
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setSelected(null);
      }}
    >
      {/* Sized to the picture so the ring inside it can be placed in frame
          pixels scaled once, and so the handles hanging off its corners are not
          clipped by anything — this box has no overflow of its own. */}
      <div className="relative" style={{ width: fitted.width, height: fitted.height }}>
        {/* Over the canvas rather than instead of it. The canvas has to keep
            its box — the ring, the handles and the hit testing are all placed
            against its size — and it has to keep painting, so what is revealed
            is a composed frame rather than the first one of a cold start. */}
        {!ready && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-lg bg-editor-panel">
            <p className="animate-pulse text-xs text-editor-muted">Loading the recording…</p>
          </div>
        )}

        <canvas
          ref={canvas}
          // `block` kills the inline baseline gap, which otherwise leaves a few
          // stray pixels under the canvas inside its grid cell.
          //
          // Invisible rather than unmounted until the assets are in: see
          // `ready`. `visibility` and not `opacity`, because a transparent
          // canvas still catches the pointer, and a drag begun on a picture
          // nobody can see yet would move it.
          className="block rounded-lg shadow-2xl"
          // Explicit pixels rather than a percentage: see the note above on why
          // `max-h-full` cannot be relied on here.
          style={{
            width: fitted.width,
            height: fitted.height,
            visibility: ready ? "visible" : "hidden",
          }}
          onPointerEnter={(event) => {
            canvasBox.current = event.currentTarget.getBoundingClientRect();
          }}
          onPointerDown={(event) => {
            // Re-read on press: a drag can start after the picture has been
            // resized by the inspector opening, with the pointer never having
            // left the canvas.
            canvasBox.current = event.currentTarget.getBoundingClientRect();

            const point = framePoint(event);

            // Captions first, because they are drawn over everything else — a
            // cue sitting on the recording would otherwise be unreachable, and
            // clicking the words you can see would select what is behind them.
            //
            // No ring and no drag: the selection is cleared because something
            // else was clicked, and there the gesture ends.
            if (captionUnder(point)) {
              setSelected(null);
              onPick?.("captions");
              return;
            }

            const found = find(point);
            // Empty background drops the selection, the same click that would
            // drop it on a canvas anywhere else.
            setSelected(found?.target ?? null);
            if (!found) return;
            onPick?.(found.target);

            // Alt turns a drag on a picture into a pan of what it is showing. The
            // corners keep resizing either way — there is nothing else a corner
            // could sensibly mean.
            grab.current =
              event.altKey && found.kind === "move" && found.target !== "watermark"
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
            // Before the guides are drawn: `patchFor` is what works out which
            // lines were caught, and it leaves them in `caught`.
            const { section, patch } = patchFor(grab.current, point, event.shiftKey);
            onDrag(section, patch);
            showGuides();
          }}
          onPointerUp={(event) => {
            grab.current = null;
            event.currentTarget.style.cursor = "";
            hideGuides();
          }}
          onPointerLeave={(event) => {
            if (grab.current) return;
            event.currentTarget.style.cursor = "";
            canvasBox.current = null;
            hideGuides();
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

        {/* The alignment guides, over the picture and under nothing. Drawn here
            rather than into the canvas for the reason the ring is: this is a
            note about the composition, not part of it, and it must not reach
            the export or the frame a saved preset takes its card from.

            Full span rather than a segment between the two pictures: what the
            line says is "this edge is on the frame's middle", and a stub would
            leave the eye to finish it. */}
        <div
          ref={guideX}
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-guide"
          style={{ display: "none" }}
        />
        <div
          ref={guideY}
          aria-hidden
          className="pointer-events-none absolute right-0 left-0 h-px bg-guide"
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}

/**
 * The logo's box in output pixels, or null when there is no logo.
 *
 * The same arithmetic `buildRenderPlan` does for its `watermark` item. Repeated
 * rather than read off the plan because the ring and the hit testing both need
 * it *now* — the plan in the draw loop is built from a ref and is a frame
 * behind a drag in flight. Four numbers and one multiplication; the plan's copy
 * is what `layout.test.ts` pins.
 */
export function watermarkRect(frame: Size, mark: SliceSettings["watermark"]): Rect | null {
  if (!mark.watermark) return null;

  const unit = Math.min(frame.width, frame.height);
  const width = mark.watermarkWidth * unit;
  const height = mark.watermarkHeight * unit;

  return {
    x: frame.width * mark.watermarkX - width / 2,
    y: frame.height * mark.watermarkY - height / 2,
    width,
    height,
  };
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
  selected: Grabbable | null,
  frame: Size,
  settings: SliceSettings,
  sources: SourceSizes,
  fitted: Size,
  zooms: readonly ZoomSlice[],
  at: number,
): void {
  if (!element) return;

  // The logo's box comes from its own settings rather than from `placement`,
  // which answers for the two pictures the arrangement places. A watermark is
  // placed by nothing but the four numbers below it.
  const box =
    selected === "watermark"
      ? watermarkRect(frame, settings.watermark)
      : selected
        ? (placement(frame, settings.layout, settings.background, sources, selected)?.dstRect ??
          null)
        : null;

  // A zoom moves the screen on its own track, leaving the box a drag reads and
  // writes exactly where it was. Following the zoom would put handles on a
  // corner that cannot be grabbed; staying put would ring empty background. So
  // for the length of the span there is no ring, and the picture is left to be
  // watched rather than edited.
  const moving =
    selected === "screen" && zooms.some((zoom) => at >= zoom.source.start && at <= zoom.source.end);

  if (!box || moving || fitted.width <= 0) {
    element.style.display = "none";
    return;
  }

  const scale = fitted.width / frame.width;
  const { x, y, width, height } = box;

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
  | { kind: "move"; target: Grabbable; box: Rect; from: Point }
  | { kind: "resize"; target: Grabbable; corner: Corner; box: Rect; from: Point }
  // Panning is the two video sources only: it slides a crop window over
  // footage, and a watermark has no crop — the whole file is the picture.
  | { kind: "pan"; target: PlanSource; from: Point; offsetX: number; offsetY: number };

/** How close to a corner counts as grabbing it, in points on screen. */
const HANDLE = 12;

/**
 * How close a dragged edge has to come before it snaps, in *screen* pixels.
 *
 * Screen rather than output pixels, so the pull feels the same whatever size
 * the preview is drawn at — the same reason `grain()` exists for the corner
 * targets. In output pixels it would be a hair on a 4K frame in a small window
 * and half the bubble on a 720p one.
 */
const SNAP = 7;

/**
 * How far in from the frame's edge the corner guides sit, as a fraction of the
 * shorter edge.
 *
 * The floor, not the answer: the composition's own padding is used where it is
 * larger, so a bubble tucked into a corner lines up with the edge of the
 * recording beside it rather than with a number of its own. This is what is
 * left when the screen is full-bleed and there is no padding to line up with —
 * near enough the inset `DEFAULT_LAYOUT` parks the camera at, which is where
 * the eye already expects a corner to be.
 */
const GUIDE_INSET = 0.05;

const CORNER_CURSOR: Record<Corner, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

/** Stands in for a cue that is not on screen, so nothing can be inside it. */
const EMPTY: Rect = { x: 0, y: 0, width: -1, height: -1 };

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
    default:
      return "over-padded";
  }
}
