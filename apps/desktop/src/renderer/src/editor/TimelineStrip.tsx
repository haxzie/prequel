import {
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
import { hasOverrides, type ZoomSlice } from "../../../shared/project";
import { cn } from "../lib/cn";
import { formatTimecode } from "../lib/format";
import { CameraIcon, CursorIcon, FillIcon, ScreenIcon, TypingIcon, ZoomIcon } from "./icons";
import { fitZoom, ticks } from "./ruler";
import {
  placedSlices,
  projectDuration,
  splitPointAt,
  zoomSpanAt,
  type EditorAction,
  type EditorState,
  type TimelineTool,
} from "./state";
import type { PlacedSlice } from "./timeline";
import type { EditorPlayback } from "./useEditorPlayback";
import { wavePath } from "./waveform";

const NS_PER_SECOND = 1_000_000_000;

/** Row geometry. */
const RULER_H = 24;
/** Space under the ruler, so its labels do not sit on top of the clips. */
const TRACK_GAP = 10;
const CLIP_H = 38;

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
  cameraSpan,
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  media: EditorPlayback;
  /** The recording's audio, for the clips to draw. Null while it decodes. */
  peaks: Float32Array | null;
  /** Source time the camera covers, or null if none was recorded. */
  cameraSpan: { start: MediaTime; end: MediaTime } | null;
}) {
  const placed = placedSlices(state.project);
  const duration = projectDuration(state.project);

  const scroller = useRef<HTMLDivElement>(null);
  const cut = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
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

  const cursor =
    state.tool === "slice" ? "cursor-scissors" : state.tool === "delete" ? "cursor-trash" : "";

  // Zooms are stored in *source* time, like everything else that describes the
  // recording; the strip measures project time. Cutting the composite shifts
  // one against the other, so the two conversions are kept here rather than
  // being re-derived at each use.
  const sourceAt = useCallback(
    (project: MediaTime): MediaTime => {
      const slice = placed.find(
        (candidate) =>
          project >= candidate.timelineStart &&
          project < candidate.timelineStart + candidate.duration,
      );
      return slice ? slice.source.start + (project - slice.timelineStart) : project;
    },
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
   * Draws the cut line under the pointer, or hides it.
   *
   * Written straight to the element rather than held in state: `pointermove`
   * fires far more often than a frame, and re-rendering the strip on each one
   * would rebuild every clip and ruler tick to move a two-pixel line.
   *
   * Hidden wherever a cut would not actually happen — on a boundary, off the
   * end, or too close to an edge to leave a grabbable slice. `splitPointAt` is
   * the same rule the reducer applies, so the line cannot promise a cut that is
   * then declined.
   */
  /**
   * Draws the outline of the zoom a click would add, or hides it.
   *
   * Written straight to the element for the same reason the cut line is:
   * `pointermove` fires far more often than a frame. `zoomSpanAt` is the rule
   * the reducer applies, so the ghost cannot offer a zoom that is then
   * declined — over an existing one, or in a gap too small to hold it, nothing
   * is drawn and nothing happens.
   */
  const showGhost = useCallback(
    (clientX: number | null) => {
      const element = ghost.current;
      if (!element) return;

      const span = clientX === null ? null : zoomSpanAt(state.project, sourceAt(timeAt(clientX)));
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

  const showCut = useCallback(
    (clientX: number | null) => {
      const element = cut.current;
      if (!element) return;

      const at = clientX === null ? null : timeAt(clientX);
      const point = at === null ? null : splitPointAt(state.project, at);

      if (point === null || at === null) {
        element.style.opacity = "0";
        return;
      }

      element.style.transform = `translate3d(${(at / Math.max(duration, 1)) * contentWidth}px, 0, 0)`;
      element.style.opacity = "1";
    },
    [state.project, timeAt, duration, contentWidth],
  );

  // Any tool but the blade, and there is nothing to preview.
  useEffect(() => {
    if (state.tool !== "slice") showCut(null);
  }, [state.tool, showCut]);

  const onClipPointerDown = (slice: PlacedSlice, event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    media.onInteract();

    if (state.tool === "slice") {
      dispatch({ type: "split", at: timeAt(event.clientX) });
      return;
    }
    if (state.tool === "delete") {
      dispatch({ type: "deleteSlice", sliceId: slice.id });
      return;
    }

    dispatch({ type: "select", sliceId: slice.id });
    // Selecting also moves the playhead, so the preview shows the clip that is
    // now being edited rather than whatever was last under the head.
    media.playback.seek(timeAt(event.clientX));
  };

  return (
    // Padded to match the transport above it, now that there is no track
    // column holding the strip off the window edge.
    <div className="flex flex-none flex-col border-t border-editor-line px-4 pt-3 pb-4">
      <div
        ref={attachScroller}
        className={cn("no-scrollbar relative overflow-x-auto overflow-y-hidden", cursor)}
        onPointerMove={(event) => {
          if (state.tool === "slice") showCut(event.clientX);
        }}
        onPointerLeave={() => showCut(null)}
      >
        <div className="relative" style={{ width: contentWidth }}>
          <Ruler
            duration={duration}
            pxPerSecond={pxPerSecond}
            onSeek={(clientX) => {
              media.onInteract();
              media.playback.seek(timeAt(clientX));
            }}
          />

          <div style={{ height: TRACK_GAP }} />

          <div
            className="flex gap-px"
            style={{ height: CLIP_H }}
            onPointerDown={(event) => {
              // The empty strip always seeks, whatever the tool: there is
              // nothing there to slice or delete.
              media.onInteract();
              media.playback.seek(timeAt(event.clientX));
            }}
          >
            {placed.map((slice) => (
              <Clip
                key={slice.id}
                slice={slice}
                duration={duration}
                peaks={peaks}
                cameraSpan={cameraSpan}
                tool={state.tool}
                selected={slice.id === state.selectedSliceId}
                overridden={hasOverrides(
                  state.project.tracks[0]?.slices.find((c) => c.id === slice.id)?.overrides,
                )}
                onPointerDown={(event) => onClipPointerDown(slice, event)}
                onTrim={(edge, clientX) =>
                  dispatch({
                    type: "trimSlice",
                    sliceId: slice.id,
                    edge,
                    // Trimming moves an edge in *source* time, which is where
                    // the slice's range lives — the project position it was
                    // dragged to is only how that was expressed.
                    source:
                      edge === "start"
                        ? slice.source.start + (timeAt(clientX) - slice.timelineStart)
                        : slice.source.end +
                          (timeAt(clientX) - slice.timelineStart - slice.duration),
                  })
                }
              />
            ))}
          </div>

          <div style={{ height: TRACK_GAP }} />

          {/* Zooms, on their own row and the same height as the clips: a row
              half the size reads as less important than the thing it is
              changing, which is backwards. */}
          <div
            className="relative"
            style={{ height: CLIP_H }}
            onPointerMove={(event) => showGhost(event.clientX)}
            onPointerLeave={() => showGhost(null)}
            onPointerDown={(event) => {
              media.onInteract();
              dispatch({ type: "addZoom", at: sourceAt(timeAt(event.clientX)) });
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
                  Click to add a zoom effect
                </span>
              </div>
            )}

            <ZoomGhost ref={ghost} />

            {state.project.zooms.map((zoom) => {
              const from = projectAt(zoom.source.start);
              const to = projectAt(zoom.source.end);
              if (to === null || from === null) return null;

              return (
                <Zoom
                  key={zoom.id}
                  left={(from / Math.max(duration, 1)) * 100}
                  width={((to - from) / Math.max(duration, 1)) * 100}
                  selected={zoom.id === state.selectedZoomId}
                  tool={state.tool}
                  target={zoom.target}
                  level={zoom.level}
                  sourceAt={(clientX) => sourceAt(timeAt(clientX))}
                  start={zoom.source.start}
                  onSelect={() => {
                    media.onInteract();
                    if (state.tool === "delete") {
                      dispatch({ type: "deleteZoom", zoomId: zoom.id });
                      return;
                    }
                    dispatch({ type: "selectZoom", zoomId: zoom.id });
                  }}
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

          <CutLine ref={cut} />
          <Playhead ref={media.playheadRef} />
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
      style={{ height: RULER_H }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onSeek(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(event.clientX);
      }}
    >
      {marks.map((mark) => (
        <div
          key={mark.at}
          className="absolute inset-y-0"
          style={{ left: `${(mark.at / Math.max(duration, 1)) * 100}%` }}
        >
          {/* Hung from the top edge, so every tick starts on the same line and
              the ruler reads as a scale rather than as a row of stubs. */}
          <div
            className={cn(
              "absolute top-0 w-px",
              mark.major ? "h-2.5 bg-white/25" : "h-1.5 bg-white/12",
            )}
          />

          {/* Under its own tick rather than beside it at the top: a label above
              the mark it belongs to reads as belonging to the one before. */}
          {mark.label && (
            <span className="absolute bottom-0 left-1 text-[9px] leading-none tabular-nums text-editor-muted">
              {mark.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The playhead.
 *
 * The playback loop rewrites this element's `transform` once per frame, so it
 * follows the clock without a React render — and without a reflow, which is
 * what `left` would have cost.
 *
 * `will-change` is declared so the compositor gives it a layer up front rather
 * than promoting it on the first move, which shows as a stutter right as
 * playback starts.
 */
function Playhead({ ref }: { ref: (element: HTMLElement | null) => void }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 -ml-px w-0.5 bg-indicator"
      style={{ willChange: "transform" }}
    >
      {/* A triangle pointing down at the line, drawn by clipping a box: the
          border trick needs a transparent-border hack, and a rotated square
          leaves the point a diagonal rather than a tip. */}
      <span className="absolute top-0 left-1/2 h-2 w-2.5 -translate-x-1/2 bg-indicator [clip-path:polygon(50%_100%,0_0,100%_0)]" />
    </div>
  );
}

/**
 * Where a cut would land, under the pointer.
 *
 * Deliberately the playhead's shape and full height so it reads as the same
 * kind of marker, and deliberately red so the two are never confused — one says
 * where you are, the other says what you are about to destroy. Running it
 * through the ruler is what lets you line a cut up against a tick.
 */
function CutLine({ ref }: { ref: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 w-0.5 bg-cut opacity-0 transition-opacity duration-75"
      style={{ willChange: "transform" }}
    >
      <span className="absolute top-0 left-1/2 h-2 w-2.5 -translate-x-1/2 bg-cut [clip-path:polygon(50%_100%,0_0,100%_0)]" />
    </div>
  );
}

function Clip({
  slice,
  duration,
  peaks,
  cameraSpan,
  tool,
  selected,
  overridden,
  onPointerDown,
  onTrim,
}: {
  slice: PlacedSlice;
  duration: MediaTime;
  peaks: Float32Array | null;
  cameraSpan: { start: MediaTime; end: MediaTime } | null;
  tool: TimelineTool;
  selected: boolean;
  overridden: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onTrim: (edge: "start" | "end", clientX: number) => void;
}) {
  const grab = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, event.clientX);
  };

  // Rebuilt only when the clip's own span moves — trimming an edge, or a cut
  // that gives it a new range. Zooming and scrolling do not touch it: the path
  // is drawn in a unit box and the SVG stretches it, so the work of resizing
  // stays in the compositor rather than coming back through React.
  const wave = useMemo(
    () => (peaks === null ? "" : wavePath(peaks, slice.source.start, slice.source.end)),
    [peaks, slice.source.start, slice.source.end],
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
        "group relative min-w-1 overflow-hidden rounded-md border",
        "border-slice-edge bg-slice-fill transition-[opacity,background-color,border-color]",
        // The whole clip dims rather than only its fill, so its label and edge
        // recede together — a full-strength border on a faded body reads as a
        // rendering glitch rather than as "not selected".
        selected ? "opacity-100" : "opacity-60",
        // With the trash held, the clip under the pointer goes red and comes to
        // full strength: this click destroys it, and the cursor alone leaves
        // *which* clip up to the user's aim. The hover states are emitted
        // exclusively — two `hover:opacity-*` classes would leave the winner to
        // stylesheet order.
        tool === "delete"
          ? "hover:border-cut hover:bg-cut/30 hover:opacity-100"
          : !selected && "hover:opacity-80",
      )}
      style={{ width: `${(slice.duration / Math.max(duration, 1)) * 100}%` }}
      onPointerDown={onPointerDown}
    >
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
          surface and all but disappears on purple. */}
      {/* Right padding clears the override dot, which sits in that corner. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 py-1.5 pr-4 pl-1.5 text-white/70">
        <span className="flex flex-none items-center gap-1 [&_svg]:size-3">
          <ScreenIcon />
          {hasCamera && <CameraIcon />}
        </span>
        <span className="truncate text-[10px] leading-none tabular-nums">
          {formatTimecode(slice.duration)}
        </span>
      </div>

      {/* Marks a clip with settings of its own, so "why does this bit look
          different?" is answerable from the strip rather than by clicking each. */}
      {overridden && (
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-editor-accent" />
      )}

      {/* Trim handles only under the select tool: with the blade held, a click
          near an edge should cut there, not resize.

          Shown outright on the selected clip and on hover otherwise — the two
          bars are what says "these ends can be dragged", and a control that
          only appears once the pointer is already on it has to be discovered
          by accident. */}
      {tool === "select" && (
        <>
          <Handle
            edge="start"
            selected={selected}
            onPointerDown={grab("start")}
            onPointerMove={move("start")}
          />
          <Handle
            edge="end"
            selected={selected}
            onPointerDown={grab("end")}
            onPointerMove={move("end")}
          />
        </>
      )}
    </div>
  );
}

/**
 * A draggable end of a clip.
 *
 * A white bar on a lightened band of the clip's own colour: light enough to
 * read as a grip against the purple, and tied to the clip rather than being a
 * colour of its own, so a row of them does not look like a separate track.
 */
function Handle({
  edge,
  selected,
  onPointerDown,
  onPointerMove,
}: {
  edge: "start" | "end";
  selected: boolean;
  onPointerDown: (event: PointerEvent<HTMLSpanElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLSpanElement>) => void;
}) {
  return (
    <span
      className={cn(
        "absolute inset-y-0 grid w-3 cursor-ew-resize place-items-center bg-white/20 transition-opacity",
        // Rounded on the outside only, so the pair reads as caps on the clip
        // rather than as two pills sitting inside it.
        edge === "start" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
        selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <span className="h-1/2 w-0.5 rounded-full bg-white" />
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
      className="pointer-events-none absolute inset-y-0 rounded border border-dashed border-selected/70 bg-selected/10 opacity-0 transition-opacity duration-75"
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
  tool,
  target,
  level,
  start,
  sourceAt,
  onSelect,
  onMove,
  onTrim,
}: {
  left: number;
  width: number;
  selected: boolean;
  tool: TimelineTool;
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
}) {
  /** Distance from the zoom's start to where it was picked up, in source time. */
  const grab = useRef<MediaTime | null>(null);

  const grabEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, event.clientX);
  };

  return (
    <div
      className={cn(
        "group absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-md border px-2",
        "border-selected/60 bg-selected/25 transition-colors",
        selected && "border-selected bg-selected/40",
        tool === "delete"
          ? "hover:border-cut hover:bg-cut/40"
          : "cursor-grab active:cursor-grabbing",
      )}
      style={{ left: `${left}%`, width: `${width}%` }}
      onPointerDown={(event) => {
        // Stops the row underneath adding a second zoom on top of this one.
        event.stopPropagation();
        onSelect();

        if (tool !== "select") return;
        grab.current = sourceAt(event.clientX) - start;
        event.currentTarget.setPointerCapture(event.pointerId);
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

      {tool === "select" && (
        <>
          <span
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-white/40"
            onPointerDown={grabEdge("start")}
            onPointerMove={moveEdge("start")}
          />
          <span
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-white/40"
            onPointerDown={grabEdge("end")}
            onPointerMove={moveEdge("end")}
          />
        </>
      )}
    </div>
  );
}
