/**
 * Where everything goes, worked out once.
 *
 * This is the only place that turns settings into geometry. The canvas preview
 * draws the result; the exporter is *handed* the result and rasterises it
 * without re-deriving anything. That is deliberate — two implementations of
 * "where does the camera sit" is how a preview and an export come to disagree,
 * and the disagreement is only ever noticed after the file is written.
 *
 * So the plan is deliberately dumb: absolute pixels in the output frame, every
 * fit mode and fraction already resolved, nothing left to interpret. What can
 * still differ between the two rasterisers is antialiasing and gradient
 * interpolation — not whether the camera is in the right corner.
 *
 * Pure, and free of any `electron`, Node or DOM import, so the arithmetic is
 * testable on its own.
 */
import type { Background, SliceSettings, ZoomSlice } from "./project.js";

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Natural dimensions of the sources being composited. */
export interface SourceSizes {
  screen: Size | null;
  camera: Size | null;
}

export type PlanSource = "screen" | "camera";

/**
 * A rounded rectangle whose corners are a superellipse.
 *
 * `exponent` 2 is a true ellipse — a circle when the radius reaches half the
 * shorter edge — and 4 is the squircle macOS uses. One number, so the canvas
 * can sample the curve and a shader can evaluate it, without either inventing
 * its own idea of the shape.
 */
export interface Shape {
  radius: number;
  exponent: number;
}

/**
 * One pointer position, already mapped into output pixels.
 *
 * `at` is source time, matching the slice's own range. Mapped here rather than
 * carried as the fraction the manifest stores, so that the rule for "where on
 * screen is the pointer" exists once — the exporter and the preview both just
 * interpolate between two numbers that are already in the frame's coordinates.
 * That is the only reason a moving thing can live in a plan that is otherwise
 * static.
 */
export interface CursorPoint {
  at: number;
  x: number;
  y: number;
  /** False where the pointer was outside the visible crop, or off the screen
      entirely. Marked rather than omitted: a hole between two samples would be
      interpolated straight through. */
  visible: boolean;
}

/**
 * One sampled destination rectangle, in output pixels, at a source time.
 *
 * What makes a zoom expressible in a plan that is otherwise static. The easing
 * is already baked into where these land, so both rasterisers only ever lerp
 * five numbers between two keys — no curve, no cursor lookup, no idea that a
 * zoom exists at all.
 *
 * The *destination* rather than the source: a zoom scales the whole picture and
 * lets it run past the edges of the frame, corners and border and all, rather
 * than cropping into the recording and leaving the frame the size it was. The
 * two look completely different — one is a camera pushing in, the other is a
 * still being enlarged.
 *
 * Every zoom's keys start and end at the un-zoomed rectangle, which is what
 * makes the gaps between zooms free: interpolating from base to base is base.
 */
export interface RectKey {
  at: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius, which grows with the picture rather than staying put. */
  radius: number;
}

export type PlanItem =
  | { kind: "fill"; rect: Rect; paint: Paint }
  | {
      kind: "shadow";
      rect: Rect;
      shape: Shape;
      blur: number;
      dy: number;
      color: string;
      motion?: RectKey[];
    }
  | {
      kind: "image";
      source: PlanSource;
      /** Region of the source to take, in source pixels. */
      srcRect: Rect;
      /** Where it lands in the output frame, in output pixels. */
      dstRect: Rect;
      shape: Shape;
      mirror: boolean;
      /** Overrides `dstRect` and the shape's radius over time, for a zoom.
          Absent when nothing moves, which is every item but a zoomed screen. */
      motion?: RectKey[];
    }
  | { kind: "stroke"; rect: Rect; shape: Shape; width: number; color: string; motion?: RectKey[] }
  | {
      kind: "cursor";
      /** Image to draw, relative to the session directory. */
      path: string;
      /** Drawn size in output pixels, square. */
      size: number;
      /** Point of the image that lands on the position, as a fraction of it. */
      hotspot: { x: number; y: number };
      points: CursorPoint[];
    };

export type Paint =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  | { kind: "image"; path: string };

export interface RenderPlan {
  frame: Size;
  /** Drawn in order, back to front. */
  items: PlanItem[];
}

/** Superellipse exponent per camera shape. */
const SHAPE_EXPONENT = { circle: 2, squircle: 4, rounded: 2, wide: 2 } as const;

/**
 * Turns settings into a flat list of things to draw.
 *
 * `sources.camera` being null, or the camera being switched off, simply omits
 * it — as does a moment before the camera started, which the caller signals the
 * same way. Nothing here holds a frame that was never recorded.
 */
export function buildRenderPlan(
  frame: Size,
  sources: SourceSizes,
  settings: SliceSettings,
  cursor?: CursorTrack | null,
  zooms?: readonly ZoomSlice[],
): RenderPlan {
  const items: PlanItem[] = [];
  const { layout, background } = settings;

  // The shorter edge is the reference for every fraction, so a setting means
  // the same thing in a landscape frame and a portrait one.
  const unit = Math.min(frame.width, frame.height);
  const full: Rect = { x: 0, y: 0, width: frame.width, height: frame.height };

  items.push({ kind: "fill", rect: full, paint: toPaint(background.background) });

  if (sources.screen) {
    const padding = background.padding * unit;
    const area: Rect = {
      x: padding,
      y: padding,
      width: Math.max(0, frame.width - padding * 2),
      height: Math.max(0, frame.height - padding * 2),
    };

    const { dstRect, srcRect } = place(sources.screen, area, layout);
    const shape: Shape = { radius: background.cornerRadius * unit, exponent: 2 };

    // One track, shared by everything that makes up the picture — the shadow
    // under it, the image, and the border around it all move together, because
    // they are one object.
    const motion = zoomKeys(
      zooms ?? [],
      frame,
      dstRect,
      srcRect,
      sources.screen,
      shape.radius,
      cursor,
    );
    const moving = motion.length > 0 ? { motion } : {};

    if (background.shadowOpacity > 0) {
      items.push({
        kind: "shadow",
        rect: dstRect,
        shape,
        blur: background.shadowBlur * unit,
        dy: background.shadowY * unit,
        color: rgba("#000000", background.shadowOpacity),
        ...moving,
      });
    }

    items.push({
      kind: "image",
      source: "screen",
      srcRect,
      dstRect,
      shape,
      mirror: false,
      ...moving,
    });

    // After the screen and before the border, so the pointer sits on the
    // picture but not over the frame's own edge.
    if (cursor && layout.cursorVisible) {
      items.push(cursorItem(cursor, sources.screen, srcRect, dstRect, unit, motion));
    }

    if (background.borderWidth > 0) {
      items.push({
        kind: "stroke",
        rect: dstRect,
        shape,
        width: background.borderWidth * unit,
        color: background.borderColor,
        ...moving,
      });
    }
  }

  if (sources.camera && layout.cameraVisible) {
    const dstRect = cameraRect(frame, layout, sources.camera);
    const wide = layout.cameraShape === "wide";

    items.push({
      kind: "image",
      source: "camera",
      // Every shape but `wide` is a square, and the camera is not — so
      // something has to be trimmed, and taking it from the middle is what
      // keeps a face centred. `wide` keeps the whole frame instead, which is
      // the point of it.
      srcRect: tightened(
        wide
          ? { x: 0, y: 0, width: sources.camera.width, height: sources.camera.height }
          : centreSquare(sources.camera),
        layout.cameraZoom,
      ),
      dstRect,
      shape: {
        // A circle is the degenerate case of the rounded rect, so there is one
        // code path rather than a special case that could drift from it. The
        // radius is measured off the shorter edge, or a wide bubble's corners
        // would grow with its width and swallow the picture.
        radius: radiusFor(layout.cameraShape, Math.min(dstRect.width, dstRect.height)),
        exponent: SHAPE_EXPONENT[layout.cameraShape],
      },
      mirror: layout.cameraMirror,
    });
  }

  return { frame, items };
}

/** How often a zoom is sampled. Fine enough that a straight line between two
    keys is indistinguishable from the curve they were taken off. */
const ZOOM_SAMPLE_NS = 1_000_000_000 / 30;

/**
 * How long the shot takes to catch up with the pointer, in seconds.
 *
 * A hand on a trackpad is not a camera operator: it overshoots, corrects, and
 * shakes, and a shot that copies it exactly is unwatchable. This is the time
 * constant of the filter that stands between the two — long enough to swallow a
 * twitch, short enough that a real move is not left behind.
 */
const FOLLOW_SECONDS = 0.45;

/**
 * Turns zoom spans into a sampled destination rectangle.
 *
 * The whole feature lives here. Everything downstream — the canvas, the
 * shader — only knows how to interpolate between two rectangles, which is what
 * keeps a zoom from being a second implementation of "where does the picture
 * sit" on the far side of an IPC boundary.
 *
 * Each span opens and closes on the un-zoomed rectangle, so the flat stretches
 * between zooms need no keys at all: interpolating base to base gives base.
 */
function zoomKeys(
  zooms: readonly ZoomSlice[],
  frame: Size,
  base: Rect,
  srcRect: Rect,
  source: Size,
  radius: number,
  cursor?: CursorTrack | null,
): RectKey[] {
  const keys: RectKey[] = [];

  for (const zoom of zooms) {
    const span = zoom.source.end - zoom.source.start;
    if (span <= 0) continue;

    // Both transitions inside the span, and never more than half of it each —
    // a 0.6s ease on a 0.5s zoom would still be arriving when it has to leave.
    const ease = Math.min(zoom.speed * 1_000_000_000, span / 2);
    const steps = Math.max(2, Math.ceil(span / ZOOM_SAMPLE_NS));

    const times = Array.from({ length: steps + 1 }, (_, step) =>
      Math.round(zoom.source.start + (span * step) / steps),
    );

    // What the shot is aimed at, moment by moment. Smoothed for the pointer,
    // because a hand's jitter is not something a camera should reproduce; a
    // region is a fixed point and has nothing to smooth.
    const aims =
      zoom.target === "region"
        ? times.map(() => ({ x: zoom.x, y: zoom.y }))
        : smoothPath(
            times.map((at) =>
              zoom.target === "typing"
                ? (typingCentre(cursor, at) ?? cursorFraction(cursor, at))
                : cursorFraction(cursor, at),
            ),
            span / steps / 1_000_000_000,
          );

    for (let step = 0; step <= steps; step += 1) {
      keys.push(
        rectFor(zoom, times[step]!, aims[step]!, ease, frame, base, srcRect, source, radius),
      );
    }
  }

  return keys;
}

/** Where the picture sits, and how big it is, at one moment of one zoom. */
function rectFor(
  zoom: ZoomSlice,
  at: number,
  point: Point,
  ease: number,
  frame: Size,
  base: Rect,
  srcRect: Rect,
  source: Size,
  radius: number,
): RectKey {
  // How far in, 0 at both edges of the span and 1 through the middle.
  const into = at - zoom.source.start;
  const left = zoom.source.end - at;
  const amount = smoothstep(Math.min(ease > 0 ? into / ease : 1, ease > 0 ? left / ease : 1));
  const level = Math.max(1, zoom.level);

  // The aim, as a point on screen right now — through the same
  // source-to-destination mapping the picture itself is drawn with.
  const focal = {
    x: base.x + ((point.x * source.width - srcRect.x) / srcRect.width) * base.width,
    y: base.y + ((point.y * source.height - srcRect.y) / srcRect.height) * base.height,
  };

  // Scaled about that point and then centred on it, so the thing being zoomed
  // to ends up in the middle of the frame rather than wherever it happened to
  // be. The picture is free to run past the edges — that is the difference
  // between a camera pushing in and a still being cropped.
  const width = base.width * level;
  const height = base.height * level;

  // Clamped so the picture never pulls away from the area it filled: a zoom
  // near an edge would otherwise show background where the recording was.
  const target = {
    x: clamp(frame.width / 2 - (focal.x - base.x) * level, base.x + base.width - width, base.x),
    y: clamp(frame.height / 2 - (focal.y - base.y) * level, base.y + base.height - height, base.y),
  };

  return {
    at,
    x: lerp(base.x, target.x, amount),
    y: lerp(base.y, target.y, amount),
    width: lerp(base.width, width, amount),
    height: lerp(base.height, height, amount),
    // The corners grow with the picture. Left alone they would tighten as it
    // scaled, which reads as the frame changing shape mid-move.
    radius: lerp(radius, radius * level, amount),
  };
}

/**
 * The middle of the focused text area at a moment, if there was one.
 *
 * Held from the last sample rather than interpolated: focus does not slide from
 * one field to the next, it moves, and easing between two of them would send
 * the shot through everything in between. The smoothing pass afterwards is what
 * turns that step into a move.
 *
 * Null wherever nothing was focused, which is most of a recording and all of
 * one made without the Accessibility grant — the caller falls back to the
 * pointer, so a `typing` zoom is never worse than a `cursor` one.
 */
function typingCentre(cursor: CursorTrack | null | undefined, at: number): Point | null {
  const spans = cursor?.typing;
  if (!spans?.length || at < spans[0]!.at) return null;

  let low = 0;
  let high = spans.length;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (spans[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const span = spans[low]!;
  // Stale after a while: a field focused a minute ago says nothing about where
  // the interesting part of the picture is now.
  if (at - span.at > TYPING_STALE_NS) return null;

  return { x: span.x + span.width / 2, y: span.y + span.height / 2 };
}

/** How long a focused field stays the answer after it was last seen. */
const TYPING_STALE_NS = 3_000_000_000;

/**
 * Smooths a path without moving it.
 *
 * A one-pole filter run forwards and then backwards. Forwards alone lags — the
 * shot would trail the pointer by the length of the filter, which reads as the
 * camera being slow rather than steady. Running it both ways cancels that lag
 * exactly, at the cost of needing the whole path up front. Which is fine: it is
 * all known before a frame is drawn, and this is the reason a zoom is baked
 * into the plan rather than evaluated live.
 */
function smoothPath(path: Point[], stepSeconds: number): Point[] {
  if (path.length < 3 || stepSeconds <= 0) return path;

  // The fraction of the gap closed per step, from the time constant.
  const alpha = 1 - Math.exp(-stepSeconds / FOLLOW_SECONDS);

  const pass = (input: Point[]): Point[] => {
    const out: Point[] = [];
    let x = input[0]!.x;
    let y = input[0]!.y;

    for (const point of input) {
      x += (point.x - x) * alpha;
      y += (point.y - y) * alpha;
      out.push({ x, y });
    }
    return out;
  };

  return pass(pass(path).reverse()).reverse();
}

/** The pointer's position at a moment, as a fraction of the captured frame. */
function cursorFraction(cursor: CursorTrack | null | undefined, at: number): Point {
  const samples = cursor?.samples;
  if (!samples?.length) return { x: 0.5, y: 0.5 };

  if (at <= samples[0]!.at) return samples[0]!;
  const last = samples[samples.length - 1]!;
  if (at >= last.at) return last;

  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const a = samples[low]!;
  const b = samples[high]!;
  const span = b.at - a.at;
  const t = span > 0 ? (at - a.at) / span : 0;

  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

interface Point {
  x: number;
  y: number;
}

/** Ease in and out, so a zoom reads as a camera move rather than a cut. */
function smoothstep(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Where text was being typed, as the manifest records it. */
export interface TypingSpan {
  at: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The pointer track as the manifest records it: fractions of the frame. */
export interface CursorTrack {
  /** Image to draw, relative to the session directory. */
  path: string;
  hotspot: { x: number; y: number };
  samples: readonly { at: number; x: number; y: number }[];
  /** Size setting, as a fraction of the frame's shorter edge. */
  size: number;
  /** Seconds of stillness before it hides, or null to leave it on screen. */
  hideAfter: number | null;
  /**
   * Focused text areas, for a zoom that follows typing.
   *
   * Carried on the cursor track because a `typing` zoom needs both: the field
   * when there is one, and the pointer for the stretches — most of a recording
   * — where nothing is focused.
   */
  typing?: readonly TypingSpan[];
}

/**
 * Turns sampled pointer fractions into output-pixel positions.
 *
 * The mapping is the same one the screen image gets: a fraction of the captured
 * frame becomes a source pixel, and a source pixel inside the crop becomes an
 * output pixel. Doing it here is what keeps the exporter from having to know
 * anything about crops or fits — it receives positions already in the frame and
 * only interpolates between them.
 *
 * A sample outside the crop is marked invisible rather than clamped. Clamping
 * would park the pointer against the edge of the picture and hold it there,
 * which reads as a bug rather than as a pointer that has left.
 */
function cursorItem(
  cursor: CursorTrack,
  source: Size,
  srcRect: Rect,
  dstRect: Rect,
  unit: number,
  motion: readonly RectKey[],
): PlanItem {
  // Sampled wherever *either* moves. The pointer's own samples are written
  // only when it moves, so a pointer held still through a zoom has two points
  // a second apart — and interpolating its screen position between them would
  // slide it across the picture while the picture was itself moving. Adding a
  // point at every motion key keeps the two in step.
  const times = new Set(cursor.samples.map((sample) => sample.at));
  for (const key of motion) times.add(key.at);

  const points: CursorPoint[] = [...times]
    .sort((a, b) => a - b)
    .map((at) => {
      const point = cursorFraction(cursor, at);
      const px = point.x * source.width;
      const py = point.y * source.height;

      // Through the picture's rectangle *at this moment*, not the un-zoomed
      // one. Mapping the pointer with a still rectangle while the picture
      // moves under it is what put it somewhere the thing it was pointing at
      // was not — and the further a zoom went, the further out it was.
      const rect = rectAt(motion, at, dstRect, 0);

      return {
        at,
        x: rect.x + ((px - srcRect.x) / srcRect.width) * rect.width,
        y: rect.y + ((py - srcRect.y) / srcRect.height) * rect.height,
        visible:
          px >= srcRect.x &&
          px <= srcRect.x + srcRect.width &&
          py >= srcRect.y &&
          py <= srcRect.y + srcRect.height,
      };
    });

  return {
    kind: "cursor",
    path: cursor.path,
    size: Math.max(1, cursor.size * unit),
    hotspot: cursor.hotspot,
    points: cursor.hideAfter === null ? points : withIdleGaps(points, cursor.hideAfter),
  };
}

/**
 * Hides the pointer wherever it sat still longer than `seconds`.
 *
 * Expressed as points rather than as a rule either rasteriser has to know
 * about: the track is only sampled when the pointer *moves*, so a long gap
 * between two samples is exactly a pointer that was parked. Two markers into
 * that gap — one holding it in place until the timeout, one invisible just
 * after — and `cursorAt` does the rest, because a span with an invisible end
 * already draws nothing. The exporter gets the behaviour without a line of
 * Rust.
 */
function withIdleGaps(points: CursorPoint[], seconds: number): CursorPoint[] {
  const timeout = Math.max(0, seconds) * 1_000_000_000;
  const out: CursorPoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    out.push(point);

    const next = points[index + 1];
    // The last sample gets the same treatment: nothing follows it, so without
    // this the pointer sits on screen for the rest of the recording.
    if (next && next.at - point.at <= timeout) continue;

    out.push({ ...point, at: point.at + timeout });
    out.push({ ...point, at: point.at + timeout + 1, visible: false });
  }

  return out;
}

/**
 * The destination rectangle and radius at a moment.
 *
 * Mirrors `rect_at` in `crates/prequel-render/src/plan.rs`. Linear between
 * keys, because the curve is already in where the keys are.
 */
export function rectAt(
  keys: readonly RectKey[],
  at: number,
  fallback: Rect,
  fallbackRadius: number,
): RectKey {
  const base = { at, ...fallback, radius: fallbackRadius };
  if (keys.length === 0) return base;

  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (at <= first.at) return first;
  if (at >= last.at) return last;

  let low = 0;
  let high = keys.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (keys[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const a = keys[low]!;
  const b = keys[high]!;
  const span = b.at - a.at;
  const t = span > 0 ? (at - a.at) / span : 0;

  return {
    at,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
    radius: lerp(a.radius, b.radius, t),
  };
}

/**
 * Where the pointer is at a moment, or null if it is not on screen.
 *
 * Shared by both rasterisers through the plan rather than by being written
 * twice: the canvas calls this per frame and the exporter's mirror of it is
 * pinned by a golden-pixel test. Linear between samples, because the track is
 * sampled at 30 Hz and playback is not.
 */
export function cursorAt(
  points: readonly CursorPoint[],
  at: number,
): { x: number; y: number } | null {
  if (points.length === 0) return null;

  // Before the first sample the pointer had not moved yet, so it was wherever
  // the first sample says — not absent.
  if (at <= points[0]!.at) return points[0]!.visible ? points[0]! : null;

  const last = points[points.length - 1]!;
  if (at >= last.at) return last.visible ? last : null;

  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const a = points[low]!;
  const b = points[high]!;
  // Either end being off screen makes the span between them off screen: the
  // pointer left somewhere in there, and guessing where is worse than not
  // drawing it for one sample's width of time.
  if (!a.visible || !b.visible) return null;

  const span = b.at - a.at;
  const t = span > 0 ? (at - a.at) / span : 0;

  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Where the screen recording lands, and which part of it is shown.
 *
 * Both at once, because they are one decision. Working them out separately is
 * how the two came to disagree: the destination was handed the whole padded
 * area under `cover` while the source window was clamped to the pixels that
 * actually exist, and a window of one shape drawn into a rectangle of another
 * is a stretched picture.
 *
 * The invariant this exists to hold: the source window and the destination
 * always have the same aspect ratio. Nothing here may return a pair that does
 * not, whatever the fit, the zoom or the shape of the frame.
 */
function place(
  source: Size,
  area: Rect,
  layout: SliceSettings["layout"],
): { dstRect: Rect; srcRect: Rect } {
  const whole: Rect = { x: 0, y: 0, width: source.width, height: source.height };
  if (area.width <= 0 || area.height <= 0) {
    return { dstRect: { ...area, width: 0, height: 0 }, srcRect: whole };
  }

  const zoom = Math.max(0.05, layout.screenZoom);

  // `contain` shows all of it, letterboxed: the whole source, scaled to fit.
  if (layout.screenFit !== "cover") {
    const scale = Math.min(area.width / source.width, area.height / source.height) * zoom;
    const width = source.width * scale;
    const height = source.height * scale;

    return {
      dstRect: {
        x: area.x + (area.width - width) / 2 + layout.screenOffsetX * area.width,
        y: area.y + (area.height - height) / 2 + layout.screenOffsetY * area.height,
        width,
        height,
      },
      srcRect: whole,
    };
  }

  // `cover` fills the area and lets the crop take the overflow, which is what
  // makes a 16:9 recording usable in a vertical frame at all.
  const scale = Math.max(area.width / source.width, area.height / source.height) * zoom;
  let windowWidth = area.width / scale;
  let windowHeight = area.height / scale;

  // There is no more source than there is. Both sides are divided by the same
  // factor, so the window keeps the area's shape and the shortfall is taken out
  // of how much of the frame gets filled — never out of the picture's
  // proportions. Zooming out past the point where the whole source is on show
  // therefore letterboxes, which is the honest answer: the pixels to fill the
  // rest were never recorded.
  const overflow = Math.max(windowWidth / source.width, windowHeight / source.height, 1);
  windowWidth /= overflow;
  windowHeight /= overflow;

  const width = area.width / overflow;
  const height = area.height / overflow;

  return {
    dstRect: {
      x: area.x + (area.width - width) / 2,
      y: area.y + (area.height - height) / 2,
      width,
      height,
    },
    // Clamped so an offset cannot walk the window off the edge of the source
    // and start sampling nothing.
    srcRect: {
      x: clamp(
        (source.width - windowWidth) / 2 + layout.screenOffsetX * source.width,
        0,
        source.width - windowWidth,
      ),
      y: clamp(
        (source.height - windowHeight) / 2 + layout.screenOffsetY * source.height,
        0,
        source.height - windowHeight,
      ),
      width: windowWidth,
      height: windowHeight,
    },
  };
}

/**
 * The camera bubble, centred on a fraction of the frame.
 *
 * Clamped so it always stays wholly inside: dragging is how it is positioned,
 * and a bubble half off the edge in the preview would be half off the edge in
 * the export too — which is a state worth making unreachable rather than one to
 * explain afterwards.
 */
export function cameraRect(
  frame: Size,
  layout: SliceSettings["layout"],
  /** The camera's own dimensions. Only consulted for the `wide` shape. */
  source?: Size | null,
): Rect {
  // `cameraSize` is the bubble's *height*, whatever its shape. Switching a
  // circle to `wide` then keeps it the size it was and grows it sideways,
  // rather than shrinking the face to fit the same square.
  const height = Math.max(1, layout.cameraSize * Math.min(frame.width, frame.height));
  const width = height * cameraAspect(layout, source);

  return {
    x:
      clamp(layout.cameraX * frame.width, width / 2, Math.max(width / 2, frame.width - width / 2)) -
      width / 2,
    y:
      clamp(
        layout.cameraY * frame.height,
        height / 2,
        Math.max(height / 2, frame.height - height / 2),
      ) -
      height / 2,
    width,
    height,
  };
}

/** How much wider than tall the bubble is. 1 for everything but `wide`. */
export function cameraAspect(layout: SliceSettings["layout"], source?: Size | null): number {
  if (layout.cameraShape !== "wide" || !source || source.height <= 0) return 1;
  return source.width / source.height;
}

/** Corner radius per shape, off the bubble's shorter edge. */
function radiusFor(shape: SliceSettings["layout"]["cameraShape"], edge: number): number {
  if (shape === "rounded") return edge * 0.18;
  // Modest, because the point of `wide` is the whole picture — a heavy round
  // starts eating the corners of what it was chosen to show.
  if (shape === "wide") return edge * 0.12;
  return edge / 2;
}

/**
 * Crops in on the middle of a rectangle.
 *
 * About its centre, so tightening the shot keeps a face where it was rather
 * than walking it towards a corner.
 */
function tightened(rect: Rect, zoom: number): Rect {
  const scale = Math.max(1, zoom);
  if (scale === 1) return rect;

  const width = rect.width / scale;
  const height = rect.height / scale;

  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

function centreSquare(source: Size): Rect {
  const edge = Math.min(source.width, source.height);
  return {
    x: (source.width - edge) / 2,
    y: (source.height - edge) / 2,
    width: edge,
    height: edge,
  };
}

function toPaint(background: Background): Paint {
  switch (background.kind) {
    case "solid":
      return { kind: "solid", color: background.color };
    case "gradient":
      return {
        kind: "gradient",
        from: background.from,
        to: background.to,
        angle: background.angle,
      };
    case "image":
      return { kind: "image", path: background.path };
  }
}

/** `#rrggbb` plus an alpha, as an `rgba()` both rasterisers can read. */
function rgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
