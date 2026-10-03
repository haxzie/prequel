/**
 * Drawing a screenshot's marks onto a 2D context.
 *
 * The geometry is `shared/annotations.ts`'s; this is the ink. Separate only
 * because `shared` is compiled without the DOM — main reads a project off disk
 * and has no canvas — and the same split captions already have: laid out in
 * `shared`, rasterised here.
 *
 * **One implementation, two callers.** The preview's overlay draws through this
 * and so does the still export, which is what makes a screenshot's file the
 * picture that was on screen rather than a second rendering of the same
 * description. See the note at the top of `shared/annotations.ts` for why marks
 * are not plan items, and why that is stronger here rather than weaker.
 *
 * Everything is in the frame's own pixels. The caller scales its context once —
 * the preview to the size of the window, the export to the size of the file —
 * so nothing below has to know how big the picture is being shown.
 */
import type { Annotation } from "../../../shared/annotations";
import { annotationBox, annotationPoint, strokeWidth } from "../../../shared/annotations";
import type { Size } from "../../../shared/layout";

/**
 * How big an arrowhead is, as a multiple of the stroke's own thickness.
 *
 * Tied to the thickness rather than to the frame, so a thin arrow gets a small
 * head and a thick one a large one — a head sized independently looks detached
 * from its own line at both ends of the slider.
 */
const HEAD = 4.2;

/** Draws every mark, back to front. */
export function paintAnnotations(
  context: CanvasRenderingContext2D,
  frame: Size,
  annotations: readonly Annotation[],
): void {
  for (const annotation of annotations) {
    context.save();
    context.globalAlpha = annotation.opacity;
    context.strokeStyle = annotation.color;
    context.fillStyle = annotation.color;
    context.lineWidth = strokeWidth(frame, annotation);
    // Round throughout. A screenshot mark is drawn by hand with a pointer, and
    // a mitred corner on a freehand stroke spikes wherever the hand changed
    // direction quickly — which is everywhere.
    context.lineCap = "round";
    context.lineJoin = "round";

    const points = annotation.points.map((point) => annotationPoint(frame, point));
    paint(context, annotation, points, frame);
    context.restore();
  }
}

function paint(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  points: { x: number; y: number }[],
  frame: Size,
): void {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return;

  switch (annotation.kind) {
    case "line":
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(last.x, last.y);
      context.stroke();
      return;

    case "arrow": {
      const size = strokeWidth(frame, annotation) * HEAD;
      const angle = Math.atan2(last.y - first.y, last.x - first.x);
      const length = Math.hypot(last.x - first.x, last.y - first.y);
      if (length === 0) return;

      // The shaft stops short of the tip rather than running to it. Drawn to
      // the point, the round cap pokes out of the head as a bead on the end of
      // an otherwise sharp arrow — visible at every thickness and unmistakable
      // at the top of the slider.
      const stop = Math.max(0, length - size * 0.8);
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(first.x + Math.cos(angle) * stop, first.y + Math.sin(angle) * stop);
      context.stroke();

      // Filled rather than stroked, so the head keeps its shape as the stroke
      // thickens: a stroked triangle this small closes into a blob.
      const spread = 0.42;
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(
        last.x - Math.cos(angle - spread) * size,
        last.y - Math.sin(angle - spread) * size,
      );
      context.lineTo(
        last.x - Math.cos(angle + spread) * size,
        last.y - Math.sin(angle + spread) * size,
      );
      context.closePath();
      context.fill();
      return;
    }

    case "pen":
      context.beginPath();
      context.moveTo(first.x, first.y);
      // Through the midpoints, each one the end of a quadratic whose control is
      // the sample itself. A stroke drawn as straight segments between raw
      // pointer samples is visibly faceted — a pointer reports in jumps, and
      // the faster the hand the longer the facets.
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index]!;
        const next = points[index + 1]!;
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      context.lineTo(last.x, last.y);
      context.stroke();
      return;

    case "rect": {
      const box = annotationBox(points);
      // The corner follows the thickness, so a thick box reads as drawn with a
      // marker rather than as a rounded rectangle with a thick edge.
      const radius = Math.min(strokeWidth(frame, annotation) * 1.2, box.width / 2, box.height / 2);
      context.beginPath();
      context.roundRect(box.x, box.y, box.width, box.height, radius);
      context.stroke();
      return;
    }

    case "ellipse": {
      const box = annotationBox(points);
      context.beginPath();
      context.ellipse(
        box.x + box.width / 2,
        box.y + box.height / 2,
        box.width / 2,
        box.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      return;
    }

    case "highlight": {
      const box = annotationBox(points);
      context.fillRect(box.x, box.y, box.width, box.height);
      return;
    }
  }
}
