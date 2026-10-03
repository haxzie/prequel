/**
 * Marks drawn over a screenshot: arrows, lines, boxes, ellipses, freehand and
 * highlighter.
 *
 * **Not plan items, and that is the one decision here worth explaining.**
 * Everything in a composition — the picture, the camera, a title, a caption —
 * goes through `buildRenderPlan`, because it has to be drawn twice: by the
 * preview's GLSL and by the exporter's MSL, which are hand-kept mirrors. An
 * annotation is drawn *once*. A screenshot's file is written by the renderer
 * itself — see `stillPng.ts` — so a single `paint` reached by both the preview
 * and the export is strictly stronger than a plan item would be: there is no
 * second rasteriser for the two to disagree in, rather than two that have to be
 * kept in step.
 *
 * Which is also the limit, said plainly: annotations are screenshots only. A
 * video goes through the Rust exporter, which does not share this file, so one
 * laid on a recording would appear in the preview and not in the export —
 * exactly the divergence `shared/layout.ts` exists to prevent. The editor does
 * not offer them on a recording.
 *
 * Geometry lives here for the same reason it lives in `layout.ts`: one answer
 * to "where is this mark", resolved to output pixels in one place, so the thing
 * somebody dragged, the thing drawn on screen and the thing written to the file
 * cannot be three different rectangles.
 *
 * The *drawing* is next door, in `editor/annotationPaint.ts`, because it needs
 * a `CanvasRenderingContext2D` and `shared` is compiled without the DOM — main
 * reads these types off disk and has no canvas. The split is the same one
 * captions already have: laid out in `shared`, rasterised in the renderer.
 */
import type { Rect, Size } from "./layout.js";

/**
 * What a mark is.
 *
 * `line` and `arrow` are one shape with and without a head, and `rect`,
 * `ellipse` and `highlight` are three outlines of two boxes — they are separate
 * kinds rather than flags because that is how they are chosen: a toolbar of six
 * tools, not three tools and three checkboxes.
 *
 * `pen` is the only one whose points are not a pair. Everything else is
 * defined by two corners, which is what a drag gives.
 */
export type AnnotationKind = "arrow" | "line" | "pen" | "rect" | "ellipse" | "highlight";

/** Kinds drawn from exactly two points — a drag's start and its end. */
export const DRAGGED_KINDS: readonly AnnotationKind[] = [
  "arrow",
  "line",
  "rect",
  "ellipse",
  "highlight",
];

export interface Point {
  /** Fraction of the frame's width. May fall outside 0–1: a mark can hang off. */
  x: number;
  /** Fraction of the frame's height. */
  y: number;
}

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /**
   * The mark's shape, as fractions of each edge.
   *
   * Two points for everything but `pen`, which carries the whole stroke. Edge
   * fractions rather than the shorter edge's, exactly as `watermarkX` is: a
   * position has to stay where it was put when the frame is reshaped, and a
   * fraction of one edge used for both would slide everything towards a corner
   * in a 9:16 frame.
   */
  points: Point[];
  /** `#rrggbb`. The only form the colour picker produces. */
  color: string;
  /**
   * Stroke thickness, as a fraction of the frame's **shorter** edge.
   *
   * The shorter edge, unlike the positions above, and for the reason every
   * other size in this app is measured against it: a thickness is one number
   * and has to mean the same amount of ink in a landscape frame and a portrait
   * one.
   */
  width: number;
  /** 0 to 1. Below 1 for the highlighter, and nothing else by default. */
  opacity: number;
}

/**
 * How thick a mark is by default, as a fraction of the shorter edge.
 *
 * About 5px on a 1080-tall frame. Thin enough not to cover what it points at,
 * thick enough to survive a screenshot being scaled into a document.
 */
export const DEFAULT_WIDTH = 0.0045;

/**
 * The highlighter's band, as a fraction of the shorter edge.
 *
 * Its own figure and never the toolbar's: the thickness buttons choose a stroke
 * weight, and a band is not a stroke. At the medium stroke the highlighter would
 * be a 4px line at 35% opacity, which reads as a mistake rather than as a
 * marker. Changing it afterwards is the panel's Thickness slider, which ranges
 * far wider for this kind.
 */
const HIGHLIGHT_WIDTH = 0.04;

/**
 * How translucent the highlighter is.
 *
 * Low enough that the words under it are still the thing being read. A marker
 * that covers its text is a redaction, which is a different tool.
 */
const HIGHLIGHT_OPACITY = 0.35;

/** The colour a mark is first drawn in — the red everything points with. */
export const DEFAULT_COLOUR = "#e5484d";

/** The highlighter's, which has to read as ink on paper rather than as a box. */
export const HIGHLIGHT_COLOUR = "#ffd84d";

/** A fresh mark of one kind, from the drag that made it. */
export function newAnnotation(
  id: string,
  kind: AnnotationKind,
  points: Point[],
  style?: { color?: string; width?: number },
): Annotation {
  const highlight = kind === "highlight";
  return {
    id,
    kind,
    points,
    color: style?.color ?? (highlight ? HIGHLIGHT_COLOUR : DEFAULT_COLOUR),
    // The band is the highlighter's own and the toolbar cannot set it — see
    // `HIGHLIGHT_WIDTH`. A yellow band and a red hairline are not one tool with
    // a setting changed, and the three thickness buttons are about the latter.
    width: highlight ? HIGHLIGHT_WIDTH : (style?.width ?? DEFAULT_WIDTH),
    opacity: highlight ? HIGHLIGHT_OPACITY : 1,
  };
}

/**
 * The box a mark occupies in output pixels, for hit testing and the ring.
 *
 * Grown by half the stroke all round, because a stroke straddles its path: a
 * box measured from the points alone misses the half of a thick line that is
 * outside them, so clicking the visible edge of an arrow would select nothing.
 */
export function annotationRect(frame: Size, annotation: Annotation): Rect {
  const points = annotation.points.map((point) => annotationPoint(frame, point));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const pad = strokeWidth(frame, annotation) / 2;

  const left = Math.min(...xs) - pad;
  const top = Math.min(...ys) - pad;

  return {
    x: left,
    y: top,
    width: Math.max(...xs) + pad - left,
    height: Math.max(...ys) + pad - top,
  };
}

/** A mark's thickness in output pixels. */
export function strokeWidth(frame: Size, annotation: Annotation): number {
  return annotation.width * Math.min(frame.width, frame.height);
}

/** One point in output pixels. Exported for the painter, like the box above. */
export function annotationPoint(frame: Size, point: Point): { x: number; y: number } {
  return { x: point.x * frame.width, y: point.y * frame.height };
}

/**
 * Whether a point in output pixels is on a mark.
 *
 * Against the path rather than the bounding box for everything but the filled
 * kinds: an arrow drawn corner to corner has a box the size of the picture, and
 * clicking anywhere near the middle of the screen would select it.
 *
 * `slack` is extra reach in output pixels, so a hairline is still clickable —
 * a 2px stroke needs a target bigger than 2px.
 */
export function annotationHit(
  frame: Size,
  annotation: Annotation,
  at: { x: number; y: number },
  slack: number,
): boolean {
  const reach = strokeWidth(frame, annotation) / 2 + slack;
  const points = annotation.points.map((point) => annotationPoint(frame, point));

  switch (annotation.kind) {
    case "highlight":
      // Filled, so anywhere inside counts — which is what makes a band over a
      // line of text grabbable along its whole length.
      return inside(annotationBox(points), at, reach);

    case "rect":
      // The outline only. A box drawn around a dialog is usually drawn *so
      // that* the dialog can be seen, and swallowing every click inside it
      // would put the mark in front of everything it frames.
      return onBox(annotationBox(points), at, reach);

    case "ellipse":
      return onEllipse(annotationBox(points), at, reach);

    default: {
      // A polyline, which covers `arrow` and `line` as the two-point case.
      for (let index = 1; index < points.length; index += 1) {
        if (nearSegment(points[index - 1]!, points[index]!, at) <= reach) return true;
      }
      return false;
    }
  }
}

/**
 * The axis-aligned box two or more points span, normalised.
 *
 * Exported for the painter, which lives in the renderer — see the note at the
 * top of this file about where the DOM is and is not.
 */
export function annotationBox(points: { x: number; y: number }[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function inside(box: Rect, at: { x: number; y: number }, reach: number): boolean {
  return (
    at.x >= box.x - reach &&
    at.x <= box.x + box.width + reach &&
    at.y >= box.y - reach &&
    at.y <= box.y + box.height + reach
  );
}

/** On the outline of a box, within `reach` — inside it does not count. */
function onBox(box: Rect, at: { x: number; y: number }, reach: number): boolean {
  if (!inside(box, at, reach)) return false;
  const inner = {
    x: box.x + reach,
    y: box.y + reach,
    width: Math.max(0, box.width - reach * 2),
    height: Math.max(0, box.height - reach * 2),
  };
  return !inside(inner, at, 0);
}

/**
 * On the outline of an ellipse, within `reach`.
 *
 * Measured in the circle the ellipse is a scaling of, which is exact enough for
 * a hit test and far cheaper than the nearest-point problem. The error is worst
 * on a very flat ellipse, where the slack it takes is a few pixels in the
 * direction the shape is already thinnest.
 */
function onEllipse(box: Rect, at: { x: number; y: number }, reach: number): boolean {
  const rx = box.width / 2;
  const ry = box.height / 2;
  if (rx <= 0 || ry <= 0) return false;

  const dx = (at.x - (box.x + rx)) / rx;
  const dy = (at.y - (box.y + ry)) / ry;
  const distance = Math.hypot(dx, dy);
  const slack = reach / Math.min(rx, ry);

  return Math.abs(distance - 1) <= slack;
}

/** How far a point is from a segment, in output pixels. */
function nearSegment(
  from: { x: number; y: number },
  to: { x: number; y: number },
  at: { x: number; y: number },
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(at.x - from.x, at.y - from.y);

  // Clamped, so a point beyond either end measures to that end rather than to
  // the infinite line — without which a click a long way off the end of a short
  // arrow would land on it.
  const along = Math.max(0, Math.min(1, ((at.x - from.x) * dx + (at.y - from.y) * dy) / length));
  return Math.hypot(at.x - (from.x + along * dx), at.y - (from.y + along * dy));
}

/**
 * Reads a stored mark back, refusing anything that would not draw.
 *
 * `project.json` is on the user's disk and is written by whatever build made it.
 * A mark with no points, a non-finite coordinate or an unknown kind draws
 * nothing and takes the rest of the layer with it — `paintAnnotations` throws
 * on a `NaN` radius — so each one is checked rather than cast.
 */
export function sanitiseAnnotations(stored: unknown): Annotation[] {
  if (!Array.isArray(stored)) return [];

  const marks: Annotation[] = [];

  for (const value of stored) {
    const mark = value as Partial<Annotation> | null;
    if (!mark || typeof mark.id !== "string") continue;
    if (!KINDS.includes(mark.kind as AnnotationKind)) continue;

    const points = Array.isArray(mark.points)
      ? mark.points.filter(
          (point): point is Point =>
            typeof (point as Point | null)?.x === "number" &&
            Number.isFinite((point as Point).x) &&
            typeof (point as Point).y === "number" &&
            Number.isFinite((point as Point).y),
        )
      : [];

    // Two, even for a stroke: one point is nothing to draw, and a `pen` with a
    // single sample is a tap rather than a mark.
    if (points.length < 2) continue;

    marks.push({
      id: mark.id,
      kind: mark.kind as AnnotationKind,
      points,
      color: typeof mark.color === "string" ? mark.color : DEFAULT_COLOUR,
      width: number(mark.width, DEFAULT_WIDTH, 0.0005, 0.2),
      opacity: number(mark.opacity, 1, 0, 1),
    });
  }

  return marks;
}

const KINDS: readonly AnnotationKind[] = [...DRAGGED_KINDS, "pen"];

function number(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
