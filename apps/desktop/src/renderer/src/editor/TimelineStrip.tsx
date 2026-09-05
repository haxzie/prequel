import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type RefObject,
} from "react";

import type { MediaTime } from "../../../shared/manifest";
import type { ZoomSlice } from "../../../shared/project";
import { cn } from "../lib/cn";
import { formatTimecode } from "../lib/format";
import { CameraIcon, CursorIcon, FillIcon, ScreenIcon, TypingIcon, ZoomIcon, RedactIcon } from "./icons";
import { fitZoom, ticks } from "./ruler";
import {
  placedSlices,
  projectDuration,
  zoomSpanAt,
  DEFAULT_BLUR_LENGTH,
  type EditorAction,
  type EditorState,
} from "./state";
import {
  spanInProject,
  toSourceTime,
  trimmedTo,
  type PlacedSlice,
  type TrimGrab,
} from "./timeline";
import { HEAD_LABEL_W, type EditorPlayback } from "./useEditorPlayback";
import { thumbs, THUMB_WIDTH } from "./filmstrip";
import type { Filmstrip } from "./useFilmstrip";
import { wavePath } from "./waveform";

const NS_PER_SECOND = 1_000_000_000;

/**
 * How far the pointer must travel before a press is drawing a zoom out rather
 * than clicking to add one.
 *
 * Without it a click with a pixel of tremor in it would ask for a zoom a pixel
 * long, which is below the shortest one worth having — so the press would be
 * declined and the click would do nothing, on the gesture that has always
 * worked. Four pixels is under a frame's width at any useful timeline scale.
 */
const DRAW_SLOP = 4;

/** Row geometry. */
const RULER_H = 24;
/**
 * Clear space above the ruler's marks.
 *
 * Part of the ruler rather than padding on the strip around it. As padding it
 * was a dozen pixels of nothing between the panel's edge and the first thing
 * that responds — close enough to the ticks to aim at, and dead. Inside the
 * ruler it seeks like the rest of it.
 */
const RULER_PAD = 12;
/** Space under the ruler, so its labels do not sit on top of the clips. */
const TRACK_GAP = 10;
/**
 * The frame a clip is drawn in, on all four sides.
 *
 * One number rather than a Tailwind `border-y-*`, because the row height below
 * is derived from it. Written as a border width in `style` for the same reason
 * — a utility class and this constant would be two places to change and one
 * would be forgotten.
 *
 * Thinner than the caps on purpose. The two ends are drag targets and have to
 * be wide enough to hit; the top and bottom are only closing the frame, and at
 * the caps' width they took a fifth of the row's height to say so.
 */
const CLIP_EDGE = 2;

/**
 * The height of a filmstrip cell, and so of a clip's *inner* box.
 *
 * The strip's frames are extracted at exactly this size and the sheet is drawn
 * unscaled, so the two have to agree or every cell shows part of its neighbour.
 * Kept separate from the row height below: framing the clip has to take its
 * room from the row rather than from the picture, or every thumbnail is
 * silently cropped by twice the band.
 */
export const CLIP_FRAME_H = 38;

/**
 * The zoom bar's frame, which is thinner than a clip's.
 *
 * Not `CLIP_EDGE`, though it was for a while. A clip's frame is drawn in a
 * purple close to its own fill and reads as the edge of a picture; a zoom's is
 * an opaque light blue around a wash of the same colour, and at the same width
 * that outline is the loudest thing in the row — the bar becomes its border.
 * The two rows still agree on radius, height and ring; they differ here because
 * the same number does not buy the same weight on both.
 */
const ZOOM_EDGE = 1;

/** Clip row height: the picture, plus the band above and below it. */
export const CLIP_H = CLIP_FRAME_H + CLIP_EDGE * 2;

/**
 * Zoom range, in pixels per second.
 *
 * The real floor is the fit zoom, computed per render — see `pxPerSecond`.
 * This one only catches a recording so long that fitting it is finer than two
 * pixels a second.
 */
const MIN_ZOOM = 2;
const MAX_ZOOM = 800;
const ZOOM_STEP = 1.3;

/**
 * The edit, as a strip.
 *
 * One row: screen, camera and both audio tracks were recorded together and are
 * cut together, so they are one clip rather than four kept in step by hand.
 * Independent tracks are what the model leaves room for, not what exists today.
 */
export function TimelineStrip({
  state,
  dispatch,
  media,
  peaks,
  filmstrip,
  cameraSpan,
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  media: EditorPlayback;
  /** The recording's audio, for the clips to draw. Null while it decodes. */
  peaks: Float32Array | null;
  /** Frame thumbnails for the whole recording, or null while they are built. */
  filmstrip: Filmstrip | null;
  /** Source time the camera covers, or null if none was recorded. */
  cameraSpan: { start: MediaTime; end: MediaTime } | null;
}) {
  const placed = placedSlices(state.project);
  const edited = projectDuration(state.project);

  /** The edge being dragged, and how long the edit was when it was picked up. */
  const [trim, setTrim] = useState<{
    sliceId: string;
    edge: "start" | "end";
    span: MediaTime;
  } | null>(null);

  /**
   * Length the strip is drawn against, held still while an edge is dragged.
   *
   * At the fit zoom the strip is always exactly as wide as the edit, so a trim
   * that shortens the edit also stretches what is left back out to fill the
   * same room: the clip's edge stays pinned where it was, the frames slide
   * about underneath it and the ruler renumbers itself — the cursor moves and
   * nothing appears to follow it. Freezing the length for the drag lets the
   * edge travel with the pointer and leaves the ruler still; the strip refits
   * when the drag ends.
   *
   * Never *below* the edit, or a clip pulled out past the length the strip
   * started at would overflow the row, and flex would shrink every clip to make
   * it fit — the same rescale, arriving all at once.
   */
  const duration = Math.max(trim?.span ?? edited, edited);

  /**
   * Room the frozen length is holding open, which a head trim takes in front of
   * its clip.
   *
   * Trimming a head is the one edit whose clip cannot move to meet the pointer:
   * slices are laid end to end, so a clip's start is wherever the one before it
   * finished, and shortening the head only pulls the clip's *far* edge inwards.
   * Dragging right and watching the wrong end come towards you is the part that
   * read as broken. The edit shrinks by exactly what the head lost, so putting
   * that much space in front of the clip stands it still and lets its start edge
   * travel with the pointer. It closes up when the drag ends and the strip refits.
   */
  const slack = duration - edited;

  const scroller = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const blurGhost = useRef<HTMLDivElement>(null);
  /** The hover line. Positioned straight on the element — see `showShadow`. */
  const shadow = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** Null means "fit the whole edit", which is what an editor should open on. */
  const [zoom, setZoom] = useState<number | null>(null);

  // Measured rather than assumed: the fit zoom depends on how much room the
  // window is giving the timeline, which changes as the inspector and the
  // window itself resize.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const measure = () => setWidth(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = fitZoom(duration, width);
  // Never below fit. Zooming out past it cannot shrink the strip — the content
  // is already as narrow as the visible width — so the only thing a smaller
  // number changed was the ruler, which went on choosing its tick interval for
  // a zoom the layout was not using and ended up with no ticks inside the
  // recording at all. An empty ruler over a full-width strip.
  const pxPerSecond = Math.max(zoom ?? fit, fit);
  const contentWidth = Math.max(width, (duration / NS_PER_SECOND) * pxPerSecond);

  // Pushed in on change rather than measured inside the playback loop, which
  // would have to flush layout to read them — every frame, while also writing
  // `scrollLeft`.
  const { setTrackMetrics } = media;
  useEffect(() => setTrackMetrics(contentWidth, width), [setTrackMetrics, contentWidth, width]);

  // One stable callback rather than an inline arrow: a fresh identity each
  // render makes React tear the ref down and set it up again every time.
  const attachScroller = useCallback(
    (element: HTMLDivElement | null) => {
      scroller.current = element;
      // Handed to the playback loop too, which scrolls it to follow the head.
      media.scrollerRef(element);
    },
    [media],
  );

  const timeAt = useCallback(
    (clientX: number): MediaTime => {
      const element = scroller.current;
      if (!element || contentWidth <= 0) return 0;

      const { left } = element.getBoundingClientRect();
      const into = clientX - left + element.scrollLeft;
      return Math.min(Math.max(0, into / contentWidth), 1) * duration;
    },
    [contentWidth, duration],
  );

  const changeZoom = useCallback(
    (factor: number) => {
      setZoom((current) => {
        // Clamped on the way in as well as on the way out, or zooming out would
        // bank a number below fit that the next few zooms in had to climb back
        // through before anything moved.
        const floor = Math.max(fitZoom(duration, width), MIN_ZOOM);
        const from = Math.max(current ?? floor, floor);
        return Math.min(Math.max(from * factor, floor), MAX_ZOOM);
      });
    },
    [duration, width],
  );

  // Pinch and ⌘-scroll zoom, which is what a trackpad user reaches for first.
  // Non-passive, because the browser's own page zoom has to be prevented.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [changeZoom]);

  // Zooms are stored in *source* time, like everything else that describes the
  // recording; the strip measures project time. Cutting the composite shifts
  // one against the other, so the two conversions are kept here rather than
  // being re-derived at each use.
  const sourceAt = useCallback(
    // `toSourceTime` rather than a second copy of the same arithmetic. The copy
    // that used to live here matched slices half-open and fell through to the
    // raw project time when nothing matched — and the far right of the strip is
    // exactly that case, because the last clip ends there. It handed back a
    // *project* time as though it were a *source* time, short by however much
    // had been cut away, so dragging a zoom's end handle to the end of a cut
    // recording moved it backwards instead of out to the end of the take.
    (project: MediaTime): MediaTime => toSourceTime(placed, project) ?? project,
    [placed],
  );

  const projectAt = useCallback(
    (source: MediaTime): MediaTime | null => {
      const slice = placed.find(
        (candidate) => source >= candidate.source.start && source <= candidate.source.end,
      );
      // A zoom over a stretch that has been cut away has nowhere to be drawn.
      return slice ? slice.timelineStart + (source - slice.source.start) : null;
    },
    [placed],
  );

  /**
   * The zoom being drawn out in the empty part of the row, if any.
   *
   * A ref rather than state, for the reason `showGhost` gives: what a drag
   * changes is an outline, and going through state would rebuild every clip,
   * tick and thumbnail on every `pointermove` to move it. `drawn` is whether
   * the pointer has travelled far enough to mean a span rather than a click.
   */
  const draw = useRef<{ at: MediaTime; x: number; drawn: boolean } | null>(null);

  /**
   * Draws the outline of the zoom a click would add — or of the one being drawn
   * out — and hides it.
   *
   * Written straight to the element rather than held in state: `pointermove`
   * fires far more often than a frame, and re-rendering the strip on each one
   * would rebuild every clip and ruler tick to move an outline.
   *
   * `zoomSpanAt` is the rule the reducer applies, so the ghost cannot offer a
   * zoom that is then declined — over an existing one, or in a gap too small to
   * hold it, nothing is drawn and nothing happens.
   */
  const showGhost = useCallback(
    (clientX: number | null) => {
      const element = ghost.current;
      if (!element) return;

      // Anchored to the press while a zoom is being drawn out, and to the
      // pointer otherwise. Both go through `zoomSpanAt`, so the outline is the
      // span that will actually be laid down rather than the rectangle the
      // pointer happens to have swept — a drag that runs back over the zoom
      // behind it stops where the zoom will.
      const drawing = draw.current;
      const pointer = clientX === null ? null : sourceAt(timeAt(clientX));
      const span =
        drawing === null
          ? pointer === null
            ? null
            : zoomSpanAt(state.project, pointer)
          : drawing.drawn && pointer !== null
            ? zoomSpanAt(state.project, drawing.at, pointer)
            : zoomSpanAt(state.project, drawing.at);
      const from = span === null ? null : projectAt(span.start);
      const to = span === null ? null : projectAt(span.end);

      if (from === null || to === null) {
        element.style.opacity = "0";
        return;
      }

      element.style.left = `${(from / Math.max(duration, 1)) * 100}%`;
      element.style.width = `${((to - from) / Math.max(duration, 1)) * 100}%`;
      element.style.opacity = "1";
    },
    [state.project, sourceAt, projectAt, timeAt, duration],
  );

  /**
   * Moves the hover line, and points the preview at the same moment.
   *
   * Written straight to the element, for the reason `showGhost` is: `pointermove`
   * fires far more often than a frame, and going through state would rebuild
   * every clip, tick and thumbnail to move a one-pixel line.
   *
   * Nothing happens during playback. The preview is already showing frames as
   * fast as it can, and a second indicator racing the playhead reads as two
   * playheads disagreeing.
   */
  const showShadow = useCallback(
    (clientX: number | null) => {
      const element = shadow.current;
      if (!element) return;

      if (clientX === null || media.playing) {
        element.style.opacity = "0";
        media.setHover(null);
        return;
      }

      const at = timeAt(clientX);
      // Through the same mapping the playhead uses, so the two line up exactly
      // rather than being a pixel apart at the same moment.
      const x = (at / Math.max(duration, 1)) * contentWidth;

      element.style.transform = `translate3d(${String(x)}px, 0, 0)`;
      element.style.opacity = "1";
      media.setHover(at);
    },
    [media, timeAt, duration, contentWidth],
  );

  const showBlurGhost = useCallback(
    (clientX: number | null) => {
      const element = blurGhost.current;
      if (!element) return;

      const source = clientX === null ? null : sourceAt(timeAt(clientX));
      const endSource = source === null ? null : Math.min(source + DEFAULT_BLUR_LENGTH, duration);
      
      const from = source === null ? null : projectAt(source);
      const to = endSource === null ? null : projectAt(endSource);

      if (from === null || to === null) {
        element.style.opacity = "0";
        return;
      }

      element.style.left = `${(from / Math.max(duration, 1)) * 100}%`;
      element.style.width = `${((to - from) / Math.max(duration, 1)) * 100}%`;
      element.style.opacity = "1";
    },
    [sourceAt, projectAt, timeAt, duration],
  );

  // Playback starting has to clear it: the line was put there by a pointer that
  // has not moved since, so nothing else would take it down.
  useEffect(() => {
    if (media.playing) showShadow(null);
  }, [media.playing, showShadow]);

  const onClipPointerDown = (slice: PlacedSlice, event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    media.onInteract();

    dispatch({ type: "select", sliceId: slice.id });
    // To the clip's start, not to where it was clicked. Editing a clip means
    // watching it from the beginning — landing wherever the pointer happened to
    // be means judging a change against an arbitrary frame, and it costs the
    // start of the clip, which is where most changes are actually visible.
    media.playback.seek(slice.timelineStart);
  };

  return (
    // Padded to match the transport above it, now that there is no track
    // column holding the strip off the window edge.
    <div className="flex flex-none flex-col bg-editor-veil px-4 pb-4">
      <div
        ref={attachScroller}
        className="no-scrollbar relative overflow-x-auto overflow-y-hidden"
        onPointerMove={(event) => showShadow(event.clientX)}
        // `pointerleave` rather than `pointerout`, which also fires on the way
        // into a child and would blink the line off over every clip.
        onPointerLeave={() => showShadow(null)}
      >
        {/* Pressing anywhere that is not a clip, a zoom or one of their handles
            seeks. Those three stop the event; everything else — the bands above
            and below the clips, the empty end of a row, the stretch of the zoom
            row where no zoom will fit — used to be dead, and there is more of it
            than there is of the strip. A timeline that ignores a press has no
            way of saying why, so it reads as the app having missed the click. */}
        <div
          className="relative"
          style={{ width: contentWidth }}
          onPointerDown={(event) => {
            media.onInteract();
            media.playback.seek(timeAt(event.clientX));
          }}
        >
          <Ruler
            duration={duration}
            pxPerSecond={pxPerSecond}
            onSeek={(clientX) => {
              media.onInteract();
              media.playback.seek(timeAt(clientX));
            }}
          />

          <div style={{ height: TRACK_GAP }} />

          <div className="flex gap-px" style={{ height: CLIP_H }}>
            {placed.map((slice) => (
              <Fragment key={slice.id}>
                {slack > 0 && trim?.edge === "start" && trim.sliceId === slice.id && (
                  <div
                    className="flex-none"
                    style={{ width: `${String((slack / Math.max(duration, 1)) * 100)}%` }}
                  />
                )}
                <Clip
                  slice={slice}
                  duration={duration}
                  peaks={peaks}
                  filmstrip={filmstrip}
                  contentWidth={contentWidth}
                  cameraSpan={cameraSpan}
                  selected={slice.id === state.selectedSliceId}
                  onPointerDown={(event) => onClipPointerDown(slice, event)}
                  onBeginEdit={(edge) => {
                    dispatch({ type: "beginEdit" });
                    setTrim({ sliceId: slice.id, edge, span: edited });
                  }}
                  onEndEdit={() => setTrim(null)}
                  onTrim={(edge, source) =>
                    dispatch({ type: "trimSlice", sliceId: slice.id, edge, source })
                  }
                />
              </Fragment>
            ))}
          </div>

          <div style={{ height: TRACK_GAP }} />

          {/* Zooms, on their own row and the same height as the clips: a row
              half the size reads as less important than the thing it is
              changing, which is backwards. */}
          <div
            className="relative"
            style={{ height: CLIP_H }}
            onPointerMove={(event) => {
              const drawing = draw.current;
              if (drawing && !drawing.drawn && Math.abs(event.clientX - drawing.x) >= DRAW_SLOP) {
                drawing.drawn = true;
              }
              showGhost(event.clientX);
            }}
            // Not while a zoom is being drawn out: the pointer is captured, so
            // the drag continues over the bars and past the ends of the row,
            // and taking the outline down there would hide the one thing
            // saying how long the zoom is going to be.
            onPointerLeave={() => {
              if (!draw.current) showGhost(null);
            }}
            // The press is one edge of the zoom; the release is the other, and
            // a press that never travels is the click this row has always
            // taken. Nothing is added until then, so a drag is one thing in the
            // undo history rather than an add followed by a resize.
            //
            // Deliberately let through to the strip, which seeks: the playhead
            // belongs on the zoom being added, and where the gap is too small
            // to hold one the press has to still do something.
            onPointerDown={(event) => {
              draw.current = {
                at: sourceAt(timeAt(event.clientX)),
                x: event.clientX,
                drawn: false,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              const drawing = draw.current;
              draw.current = null;
              if (!drawing) return;

              event.currentTarget.releasePointerCapture(event.pointerId);
              media.onInteract();
              dispatch({
                type: "addZoom",
                at: drawing.at,
                ...(drawing.drawn ? { to: sourceAt(timeAt(event.clientX)) } : {}),
              });
              // The zoom itself is now drawn where the outline was, and the
              // project this closure can see is the one from before it existed
              // — so the outline would sit exactly on top of the new bar until
              // the pointer moved again.
              showGhost(null);
            }}
            onPointerCancel={() => {
              draw.current = null;
              showGhost(null);
            }}
          >
            {/* Stuck to the left edge of the scrollport and as wide as it, so
                the invitation stays in the middle of what is on screen however
                far the timeline is scrolled. */}
            {state.project.zooms.length === 0 && (
              <div
                className="pointer-events-none sticky left-0 flex h-full items-center justify-center"
                style={{ width }}
              >
                <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-[11px] text-editor-muted [&_svg]:size-3.5">
                  <ZoomIcon />
                  Click or drag to add a zoom effect
                </span>
              </div>
            )}

            <ZoomGhost ref={ghost} />

            {state.project.zooms.map((zoom) => {
              // The whole span, not its two edges asked about separately. An
              // automatic zoom is placed against the recording and a later cut
              // can remove the moment it starts on — which used to leave the
              // bar undrawn while the zoom still occupied its source range, so
              // those seconds took clicks and did nothing at all.
              const span = spanInProject(placed, zoom.source);
              if (span === null) return null;
              const { start: from, end: to } = span;

              return (
                <Zoom
                  key={zoom.id}
                  left={(from / Math.max(duration, 1)) * 100}
                  width={((to - from) / Math.max(duration, 1)) * 100}
                  selected={zoom.id === state.selectedZoomId}
                  target={zoom.target}
                  level={zoom.level}
                  sourceAt={(clientX) => sourceAt(timeAt(clientX))}
                  start={zoom.source.start}
                  onSelect={() => {
                    media.onInteract();
                    dispatch({ type: "selectZoom", zoomId: zoom.id });
                  }}
                  onBeginEdit={() => dispatch({ type: "beginEdit" })}
                  onMove={(start) => dispatch({ type: "moveZoom", zoomId: zoom.id, start })}
                  onTrim={(edge, clientX) =>
                    dispatch({
                      type: "trimZoom",
                      zoomId: zoom.id,
                      edge,
                      source: sourceAt(timeAt(clientX)),
                    })
                  }
                />
              );
            })}
          </div>

          <div style={{ height: TRACK_GAP }} />

          {/* Blurs */}
          <div
            className="relative"
            style={{ height: CLIP_H }}
            onPointerMove={(event) => showBlurGhost(event.clientX)}
            onPointerLeave={() => showBlurGhost(null)}
            onPointerDown={(event) => {
              const outputTime = timeAt(event.clientX);
              dispatch({ type: "addBlur", at: sourceAt(outputTime) });
              media.playback.seek(outputTime);
            }}
          >
            {state.project.blurs.length === 0 && (
              <div
                className="pointer-events-none sticky left-0 flex h-full items-center justify-center"
                style={{ width }}
              >
                <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-[11px] text-editor-muted [&_svg]:size-3.5">
                  <RedactIcon />
                  Click to add a blur effect
                </span>
              </div>
            )}

            <BlurGhost ref={blurGhost} />

            {state.project.blurs.map((blur) => {
              const span = spanInProject(placed, blur.source);
              if (span === null) return null;
              const { start: from, end: to } = span;

              return (
                <Blur
                  key={blur.id}
                  left={(from / Math.max(duration, 1)) * 100}
                  width={((to - from) / Math.max(duration, 1)) * 100}
                  selected={blur.id === state.selectedBlurId}
                  sourceAt={(clientX) => sourceAt(timeAt(clientX))}
                  start={blur.source.start}
                  onSelect={() => {
                    media.onInteract();
                    dispatch({ type: "selectBlur", blurId: blur.id });
                    media.playback.seek(from);
                  }}
                  onBeginEdit={() => dispatch({ type: "beginEdit" })}
                  onMove={(start) => dispatch({ type: "moveBlur", blurId: blur.id, start })}
                  onTrim={(edge, clientX) =>
                    dispatch({
                      type: "trimBlur",
                      blurId: blur.id,
                      edge,
                      source: sourceAt(timeAt(clientX)),
                    })
                  }
                />
              );
            })}
          </div>

          <Shadow ref={shadow} />
          <Playhead ref={media.playheadRef} labelRef={media.headTimeRef} />
        </div>
      </div>
    </div>
  );
}

function Ruler({
  duration,
  pxPerSecond,
  onSeek,
}: {
  duration: MediaTime;
  pxPerSecond: number;
  onSeek: (clientX: number) => void;
}) {
  const marks = ticks(duration, pxPerSecond);

  return (
    <div
      // Always seeks, whatever the tool is — a ruler that cut would be a trap.
      // No bottom rule: the gap below already separates it from the clips, and
      // a line as well boxes the ruler in rather than letting the ticks read as
      // marks on the timeline itself.
      className="relative cursor-default select-none"
      style={{ height: RULER_H + RULER_PAD }}
      onPointerDown={(event) => {
        // Stops the strip underneath seeking to the same place a second time.
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onSeek(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(event.clientX);
      }}
    >
      {/* The marks sit in the lower part of the box; the space above them is
          the same control, just empty. */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: RULER_H }}>
        {marks.map((mark) => (
          <div
            key={mark.at}
            className="absolute inset-y-0"
            style={{ left: `${(mark.at / Math.max(duration, 1)) * 100}%` }}
          >
            {/* Hung from the top edge, so every tick starts on the same line
                and the ruler reads as a scale rather than a row of stubs. */}
            <div
              className={cn(
                "absolute top-0 w-px",
                mark.major ? "h-2.5 bg-white/25" : "h-1.5 bg-white/12",
              )}
            />

            {/* Under its own tick rather than beside it at the top: a label
                above the mark it belongs to reads as belonging to the one
                before. */}
            {mark.label && (
              <span className="absolute bottom-0 left-1 text-[9px] leading-none tabular-nums text-editor-muted">
                {mark.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The playhead, with the time on it.
 *
 * The playback loop rewrites this element's `transform` once per frame, so it
 * follows the clock without a React render — and without a reflow, which is
 * what `left` would have cost.
 *
 * `will-change` is declared so the compositor gives it a layer up front rather
 * than promoting it on the first move, which shows as a stutter right as
 * playback starts.
 */
function Playhead({
  ref,
  labelRef,
}: {
  ref: (element: HTMLElement | null) => void;
  labelRef: (element: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 -ml-px w-0.5 bg-indicator"
      style={{ willChange: "transform" }}
    >
      {/* The time, rather than the triangle that used to sit here. The head is
          where the eye already is while scrubbing, and a marker that only says
          "here" spends that attention on something the line has already said —
          the readout it sends you looking for is at the far end of the
          transport.

          Its own `transform`, written by the same loop: the label is centred on
          the line and clamped to the content, because the timeline scrolls and
          a label centred on a head at zero would be cut in half by the
          scroller's edge. The width is fixed for the same reason it is tabular
          — a label that resized as the digits changed would shimmy around the
          line it is meant to mark.

          `text-editor-bg` rather than white: `--indicator` is a light blue, and
          white over it is the pairing the palette already warns about for
          `--export` — 2.9:1 against 6.6:1 for the panel's own near-black. */}
      <span
        ref={labelRef}
        className="absolute top-0 left-1/2 h-3.5 rounded-full bg-indicator text-center text-[10px] leading-[0.875rem] font-medium tabular-nums text-editor-bg"
        style={{
          width: HEAD_LABEL_W,
          transform: "translate3d(-50%, 0, 0)",
          willChange: "transform",
        }}
      />
    </div>
  );
}

/**
 * The hover line: where the preview is looking, without having gone there.
 *
 * Deliberately not the playhead's own shape. It is thinner, dimmer and has no
 * handle at the top, because the difference that matters is "this is a look, not
 * a position" — two identical lines would leave the user hunting for which one
 * the edit will act on. Drawn under the playhead so the real one wins when they
 * meet.
 */
function Shadow({ ref }: { ref: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 left-0 z-0 w-px bg-indicator/40 opacity-0"
      style={{ willChange: "transform, opacity" }}
      aria-hidden="true"
    />
  );
}

function Clip({
  slice,
  duration,
  peaks,
  filmstrip,
  contentWidth,
  cameraSpan,
  selected,
  onPointerDown,
  onTrim,
  onBeginEdit,
  onEndEdit,
}: {
  slice: PlacedSlice;
  duration: MediaTime;
  peaks: Float32Array | null;
  filmstrip: Filmstrip | null;
  /** The strip's full width in pixels, which is what the zoom actually sets. */
  contentWidth: number;
  cameraSpan: { start: MediaTime; end: MediaTime } | null;
  selected: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  /** An edge has been dragged to a source time. Clamping is the reducer's job. */
  onTrim: (edge: "start" | "end", source: MediaTime) => void;
  /** A drag is beginning, so its stream of trims is one step to undo. */
  onBeginEdit: (edge: "start" | "end") => void;
  /** The drag is over, so the strip can go back to following the edit. */
  onEndEdit: () => void;
}) {
  /**
   * Where the drag started. Null between drags.
   *
   * A ref rather than state: this is written on `pointerdown` and read on every
   * `pointermove`, and re-rendering the clip to record where a gesture began
   * would rebuild its filmstrip and wave for no visible change.
   */
  const grabbed = useRef<TrimGrab | null>(null);

  const grab = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    grabbed.current = {
      source: slice.source[edge],
      clientX: event.clientX,
      // The strip's scale, taken now and held for the drag — see `trimmedTo`.
      perPixel: contentWidth > 0 ? duration / contentWidth : 0,
    };
    onBeginEdit(edge);
  };

  const move = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    const from = grabbed.current;
    if (from === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, trimmedTo(from, event.clientX));
  };

  // `pointercancel` as well as `pointerup`: a drag that leaves through a
  // gesture the system claims — a three-finger swipe over the trackpad — gets
  // no `pointerup` at all, and the strip would stay frozen at the length it had
  // when the drag began until the next one released it.
  const release = () => {
    if (grabbed.current === null) return;
    grabbed.current = null;
    onEndEdit();
  };

  // Rebuilt only when the clip's own span moves — trimming an edge, or a cut
  // that gives it a new range. Zooming and scrolling do not touch it: the path
  // is drawn in a unit box and the SVG stretches it, so the work of resizing
  // stays in the compositor rather than coming back through React.
  const wave = useMemo(
    () => (peaks === null ? "" : wavePath(peaks, slice.source.start, slice.source.end)),
    [peaks, slice.source.start, slice.source.end],
  );

  // The clip's width in real pixels, which is the only thing the zoom changes
  // about the strip. Derived rather than measured: reading it off the element
  // would need a layout flush per clip per zoom step, and the number is already
  // known — a clip's share of `contentWidth`.
  const widthPx = duration > 0 ? (slice.duration / duration) * contentWidth : 0;

  // Recomputed on zoom, which is the point: more room means more frames. Cheap
  // enough to do in render — it is one loop over the columns that will be drawn,
  // and it produces no images, only offsets into a sheet that already exists.
  const strip = useMemo(
    () => (filmstrip === null ? [] : thumbs(slice, widthPx, filmstrip.cadence)),
    [filmstrip, slice, widthPx],
  );

  // Overlap rather than "was a camera recorded": a clip trimmed to the first
  // moments of the take can sit entirely before the camera opened, and an icon
  // promising footage that is not in this clip is worse than no icon.
  const hasCamera =
    cameraSpan !== null &&
    slice.source.start < cameraSpan.end &&
    slice.source.end > cameraSpan.start;

  return (
    <div
      className={cn(
        "group relative min-w-1 overflow-hidden rounded-lg border",
        "transition-[background-color,border-color,outline-color]",
        // Two solid steps of the same purple, not one pair dimmed — see
        // `--slice-fill`. This is what says "selected"; the ring below says
        // "the pointer is talking to this one", and they are different
        // questions. Hover deliberately does *not* take the active pair: it
        // already draws the full ring, and brightening the fill as well would
        // make a hovered clip identical to the selected one.
        selected
          ? "border-slice-edge-active bg-slice-fill-active"
          : "border-slice-edge bg-slice-fill",
        // `outline` rather than `border` or `ring` because an outline is
        // painted after the element's children — so it runs across the two
        // handle bands instead of stopping short of them, and the clip reads
        // as one ringed shape rather than a body with two bare caps.
        //
        // Hover and selection are drawn identically, deliberately. The ring is
        // the answer to "which clip is this pointer talking to", and a dimmer
        // version of it for hover made that answer arrive in two strengths for
        // no difference the user acts on.
        // `outline-transparent` belongs to the unselected branch, not beside
        // the width. Both it and `outline-slice-ring` are plain `outline-color`
        // utilities of equal specificity, so which one wins is decided by the
        // order Tailwind emits them in its own stylesheet and not by the order
        // they are written here — and it emitted the transparent one last. The
        // selected clip lost its ring outright, while hover kept one, because
        // `hover:` adds a pseudo-class and outranks them both. Nothing about
        // the class list looked wrong.
        // The offset is the outline's full width, not half of it.
        // `outline-offset` moves the *outline edge*, and the ring is painted
        // outward from there — so at `-1` with a 2px outline a pixel of it
        // lands outside the box. Between clips that overhang is invisible, it
        // falls on the neighbour; on the first and last it lands outside the
        // scroller's content box, where `overflow-x` clips it, and the ring
        // came out cut off down the two edges of the screen and nowhere else.
        // At `-2` it ends flush with the box and is wholly inside it.
        "outline-2 -outline-offset-2",
        selected ? "outline-slice-ring" : "outline-transparent hover:outline-slice-ring",
      )}
      style={{
        width: `${(slice.duration / Math.max(duration, 1)) * 100}%`,
        // All four sides, so the clip reads as a framed picture. It used to be
        // the top and bottom only, which was invisible while the caps covered
        // the sides at rest — now that they fade out, a 1px side against a 2px
        // top reads as a rendering fault. Set here rather than as a border
        // utility so `CLIP_EDGE` stays the one place the thickness lives: the
        // row height is derived from it.
        borderWidth: CLIP_EDGE,
      }}
      onPointerDown={onPointerDown}
    >
      {/* The recording's frames, as the clip's own backdrop.

          One sheet for the whole take, shifted per column — so zooming changes
          how many of these there are and never asks for another decode. Each is
          a plain div rather than an `img`: the sheet is one image the browser has
          already decoded once, and `background-position` picks a frame out of it
          without a second copy per thumbnail.

          Behind everything else, and dimmed hard: this is orientation, not
          content. At full strength it competes with the wave and makes the
          label unreadable over a bright frame. */}
      {filmstrip !== null &&
        strip.map((thumb) => (
          <div
            key={thumb.x}
            className="pointer-events-none absolute top-0 opacity-35"
            style={{
              left: thumb.x,
              width: THUMB_WIDTH,
              height: "100%",
              backgroundImage: `url(${filmstrip.sheet})`,
              // The sheet's own size, unscaled. Cells were cropped to exactly
              // this box when they were drawn, so any scaling here would both
              // resample the frame and put the sprite offsets out of step with
              // it — the strip would show slivers of two frames per cell.
              backgroundSize: "auto",
              backgroundPosition: `-${String(thumb.index * THUMB_WIDTH)}px 0`,
              backgroundRepeat: "no-repeat",
            }}
            aria-hidden="true"
          />
        ))}

      {/* The clip's audio, standing on its floor.
          `preserveAspectRatio="none"` is the whole trick: the path is built
          once in a 0–1 box and the browser stretches it to whatever width the
          zoom has given the clip, so scrubbing the zoom does not rebuild a
          path per clip per frame. `vectorEffect` is deliberately absent — this
          is a fill, and nothing here is stroked. */}
      {wave && (
        <svg
          // `w-full` rather than `inset-x-0`: an SVG is a replaced element with
          // an intrinsic aspect ratio, and an absolutely positioned replaced
          // element with `left`/`right` but no width does not stretch between
          // them — CSS resolves the width from the ratio and anchors it left.
          // The wave then draws into a box as wide as it is tall, bunched in
          // the corner, with `preserveAspectRatio` never getting a say.
          className="pointer-events-none absolute bottom-0 left-0 h-3/5 w-full text-wave opacity-40"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={wave} fill="currentColor" />
        </svg>
      )}

      {/* One row along the top: what the clip holds, and how long it runs. Both
          up here because the wave owns the bottom now, and a label sitting over
          a wave is legible in the quiet passages and not in the loud ones.

          The screen icon is always there — a take without one is not something
          this app records — so it reads as the anchor the camera icon appears
          beside rather than as news in itself. Tinted off the clip rather than
          off the panel: `--editor-muted` is picked to sit on a near-black
          surface and all but disappears on purple.

          Padded clear of the edge bands rather than tucked to the box: the
          bands are opaque, so a smaller inset does not crowd the icon, it
          buries it. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 px-3.5 py-1 text-white/70">
        <span className="flex flex-none items-center gap-1 [&_svg]:size-3">
          <ScreenIcon />
          {hasCamera && <CameraIcon />}
        </span>
        <span className="truncate text-[10px] leading-none tabular-nums">
          {formatTimecode(slice.duration)}
        </span>
      </div>

      {/* Shown with the pointer, not at rest. The clip is already framed on
          every side, so a cap is a trim target rather than the edge itself —
          and one drawn permanently put a heavy block at both ends of every
          clip in the row, saying "this can be dragged" about all of them at
          once. They stay grabbable while invisible; see `Handle`. */}
      <>
        <Handle
          edge="start"
          selected={selected}
          onPointerDown={grab("start")}
          onPointerMove={move("start")}
          onRelease={release}
        />
        <Handle
          edge="end"
          selected={selected}
          onPointerDown={grab("end")}
          onPointerMove={move("end")}
          onRelease={release}
        />
      </>
    </div>
  );
}

/**
 * A draggable end of a clip or a zoom.
 *
 * A grip and a hit area, and no plate behind it. A solid band was here for a
 * while so that the edge and the handle would be one shape; what it actually
 * did was put a heavy block at both ends of every bar in the row, competing
 * with the frame that already says where the bar ends.
 *
 * Wide enough to grab, and wider than it looks: the grip is 2px and this is
 * 12px, because a target the size of its own artwork is one the pointer misses.
 */
function Handle({
  edge,
  selected,
  onPointerDown,
  onPointerMove,
  onRelease,
}: {
  edge: "start" | "end";
  selected: boolean;
  onPointerDown: (event: PointerEvent<HTMLSpanElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLSpanElement>) => void;
  /** The drag ended, however it ended. Absent on the zoom row, which has
      nothing held open for the length of a drag to put back. */
  onRelease?: () => void;
}) {
  return (
    <span
      className={cn(
        "absolute inset-y-0 grid w-3 cursor-ew-resize place-items-center",
        edge === "start" ? "left-0" : "right-0",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
    >
      {/* Faded rather than unmounted, and the hit area around it never fades at
          all: an edge that only becomes grabbable once it is visible is one the
          first drag at it always misses. */}
      <span
        className={cn(
          "h-1/2 w-0.5 rounded-full bg-white transition-opacity",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      />
    </span>
  );
}

/**
 * The zoom a click would add, under the pointer.
 *
 * Dashed and translucent so it reads as a proposal rather than as something
 * already there. Positioned by hand rather than through React — see `showGhost`.
 */
function ZoomGhost({ ref }: { ref: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 rounded border border-dashed border-zoom-ring/70 bg-zoom-fill/15 opacity-0 transition-opacity duration-75"
    />
  );
}

/**
 * One zoom span.
 *
 * Draggable along the row as well as trimmable: where a zoom happens is the
 * thing most often wrong about it, and re-cutting both edges to move it a
 * second is not how anyone thinks about that.
 */
function Zoom({
  left,
  width,
  selected,
  target,
  level,
  start,
  sourceAt,
  onSelect,
  onMove,
  onTrim,
  onBeginEdit,
}: {
  left: number;
  width: number;
  selected: boolean;
  /** What the zoom follows, which is the one thing about it worth seeing from
      the strip — the level and the speed only mean anything next to a picture. */
  target: ZoomSlice["target"];
  /** How far in. The one number about a zoom worth reading from the strip —
      how long it runs is already its width. */
  level: number;
  /** Where this zoom currently starts, in source time. */
  start: MediaTime;
  /** Source time under a client x, so a drag can be measured in the timeline's
      own units rather than in pixels that mean different things at each zoom. */
  sourceAt: (clientX: number) => MediaTime;
  onSelect: () => void;
  onMove: (start: MediaTime) => void;
  onTrim: (edge: "start" | "end", clientX: number) => void;
  /** A drag is beginning, so its stream of moves or trims is one step to undo. */
  onBeginEdit: () => void;
}) {
  /** Distance from the zoom's start to where it was picked up, in source time. */
  const grab = useRef<MediaTime | null>(null);

  const grabEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onBeginEdit();
  };

  const moveEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, event.clientX);
  };

  return (
    <div
      className={cn(
        "group absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-lg border px-3.5",
        "transition-[background-color,outline-color]",
        // A wash inside an outline, filling in solid when it is selected.
        //
        // The outline is opaque in both states and the fill is the only thing
        // that changes, so "which zoom am I editing" is one question answered
        // once. A clip says it with a step between two solid purples because a
        // clip is opaque either way — it carries a filmstrip. A zoom has
        // nothing behind it, so it can say the same thing by being see-through
        // until it matters, which keeps the row underneath readable.
        "border-zoom-edge",
        selected ? "bg-zoom-fill" : "bg-zoom-fill/25",
        // Split the same way a clip's is, and for the same reason — see the
        // outline note on `Clip`. This row had the identical bug.
        "outline-2 -outline-offset-2",
        selected ? "outline-zoom-ring" : "outline-transparent hover:outline-zoom-ring/40",
        "cursor-grab active:cursor-grabbing",
      )}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        borderWidth: ZOOM_EDGE,
      }}
      onPointerDown={(event) => {
        // Stops the row underneath adding a second zoom on top of this one.
        event.stopPropagation();
        onSelect();
        grab.current = sourceAt(event.clientX) - start;
        event.currentTarget.setPointerCapture(event.pointerId);
        onBeginEdit();
      }}
      onPointerMove={(event) => {
        if (grab.current === null) return;
        onMove(sourceAt(event.clientX) - grab.current);
      }}
      onPointerUp={() => {
        grab.current = null;
      }}
    >
      {/* Truncated rather than wrapped: a zoom half a second long is a few
          pixels wide at a fitted timeline, and its label has to degrade to
          nothing without changing the row's height. */}
      <span className="pointer-events-none flex min-w-0 items-center gap-1.5 text-[10px] text-white/85 [&_svg]:size-3 [&_svg]:flex-none">
        <ZoomIcon />
        {target === "cursor" ? <CursorIcon /> : target === "typing" ? <TypingIcon /> : <FillIcon />}
        <span className="truncate tabular-nums">{level.toFixed(1)}×</span>
      </span>

      <Handle
        edge="start"
        selected={selected}
        onPointerDown={grabEdge("start")}
        onPointerMove={moveEdge("start")}
      />
      <Handle
        edge="end"
        selected={selected}
        onPointerDown={grabEdge("end")}
        onPointerMove={moveEdge("end")}
      />
    </div>
  );
}

/**
 * The blur a click would add, under the pointer.
 */
function BlurGhost({ ref }: { ref: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 rounded border border-dashed border-red-500/70 bg-red-500/10 opacity-0 transition-opacity duration-75"
    />
  );
}

/**
 * One blur span.
 */
function Blur({
  left,
  width,
  selected,
  start,
  sourceAt,
  onSelect,
  onMove,
  onTrim,
  onBeginEdit,
}: {
  left: number;
  width: number;
  selected: boolean;
  /** Where this blur currently starts, in source time. */
  start: MediaTime;
  /** Source time under a client x. */
  sourceAt: (clientX: number) => MediaTime;
  onSelect: () => void;
  onMove: (start: MediaTime) => void;
  onTrim: (edge: "start" | "end", clientX: number) => void;
  onBeginEdit: () => void;
}) {
  const grab = useRef<MediaTime | null>(null);

  const grabEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onBeginEdit();
  };

  const moveEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, event.clientX);
  };

  return (
    <div
      className={cn(
        "group absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-lg border px-2",
        "border-red-500/60 bg-red-500/25 transition-colors",
        selected && "border-red-500 bg-red-500/40",
        "cursor-grab active:cursor-grabbing",
      )}
      style={{ left: `${left}%`, width: `${width}%` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
        grab.current = sourceAt(event.clientX) - start;
        event.currentTarget.setPointerCapture(event.pointerId);
        onBeginEdit();
      }}
      onPointerMove={(event) => {
        if (grab.current === null) return;
        onMove(sourceAt(event.clientX) - grab.current);
      }}
      onPointerUp={() => {
        grab.current = null;
      }}
    >
      <span className="pointer-events-none flex min-w-0 items-center gap-1.5 text-[10px] text-white/85 [&_svg]:size-3 [&_svg]:flex-none">
        <RedactIcon />
        <span className="truncate tabular-nums">Blur</span>
      </span>

      <Handle
        edge="start"
        selected={selected}
        onPointerDown={grabEdge("start")}
        onPointerMove={moveEdge("start")}
      />
      <Handle
        edge="end"
        selected={selected}
        onPointerDown={grabEdge("end")}
        onPointerMove={moveEdge("end")}
      />
    </div>
  );
}
