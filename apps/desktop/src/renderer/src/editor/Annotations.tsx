/**
 * A screenshot's marks, drawn over the composition.
 *
 * A second canvas laid exactly over the composition's, in its own 2D context,
 * and the reason it is separate is the same reason `stillPng.ts` copies before
 * it annotates: one canvas has one context for its life, and the composition's
 * is WebGL.
 *
 * It draws through `paintAnnotations`, which is also what writes the file — so
 * there is one implementation of where a mark sits and what it looks like, and
 * the picture on screen is the picture that is saved. The mark being drawn goes
 * through the same painter: a drag is drawn as the mark it is about to become
 * rather than as a preview of one, so nothing changes shape when the pointer is
 * let go.
 *
 * **It listens for nothing.** Every gesture on the picture — selecting a mark,
 * moving one, pulling its corner, drawing a new one — belongs to the preview,
 * because that is where "what is under the pointer" is answered for the camera,
 * the logo and the texts as well. This surface covering the whole picture and
 * taking presses of its own is what stopped a screenshot from being dragged at
 * all once anything had been drawn on it: the press never reached the canvas
 * that knows where the picture is.
 *
 * Everything here is in the **frame's** own pixels. The canvas is backed at the
 * frame's size × the device ratio and scaled down by CSS, so the context is
 * handed one transform and the marks never learn how big the picture happens to
 * be on screen.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import type { Annotation, AnnotationKind, Point } from "../../../shared/annotations";
import { annotationBox, annotationPoint, newAnnotation } from "../../../shared/annotations";
import { paintAnnotations } from "./annotationPaint";
import type { Size } from "../../../shared/layout";

export function Annotations({
  frame,
  annotations,
  drawing,
  ink,
}: {
  /** The output frame in pixels, which is the coordinate space of everything here. */
  frame: Size;
  annotations: readonly Annotation[];
  /** The mark being drawn, or null between gestures — the preview's. */
  drawing: { kind: AnnotationKind; points: Point[] } | null;
  /** What a new mark is drawn in, so the one in flight lands unchanged. */
  ink: { color: string; width: number };
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // The backing follows the frame and the display, like the composition's.
  // Never the output resolution in CSS pixels — see the house rule about sizing
  // a canvas to its output.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(frame.width * ratio);
    const height = Math.round(frame.height * ratio);
    if (element.width !== width) element.width = width;
    if (element.height !== height) element.height = height;
  }, [frame.width, frame.height]);

  // Repainted when the marks change, and not per frame: a still does not move,
  // so there is nothing to animate and a `requestAnimationFrame` loop here
  // would be sixty redraws a second of an unchanging picture.
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, element.width, element.height);

    // One transform, so everything below is in frame pixels — the same
    // coordinates the export draws in.
    const scale = element.width / Math.max(frame.width, 1);
    context.scale(scale, scale);

    paintAnnotations(context, frame, annotations);

    if (!drawing || drawing.points.length < 2) return;

    // A mask in flight, which is the one mark that cannot be drawn as what it
    // will become: what it becomes is the picture underneath with the detail
    // taken out, and that is the compositor's — this canvas has none of those
    // pixels. So the drag shows the rectangle it is making. Without it a mask
    // is dragged out against no feedback at all, which reads as the tool having
    // failed until the pointer is let go.
    if (drawing.kind === "mask") {
      const box = annotationBox(drawing.points.map((at) => annotationPoint(frame, at)));
      const edge = Math.max(1, Math.min(frame.width, frame.height) * 0.002);

      context.save();
      context.fillStyle = "rgba(0, 0, 0, 0.45)";
      context.fillRect(box.x, box.y, box.width, box.height);
      context.strokeStyle = "rgba(255, 255, 255, 0.9)";
      context.lineWidth = edge;
      // Dashed, so the outline reads as a region being chosen rather than as a
      // box being drawn — the box tool is two buttons away and draws a solid
      // one.
      context.setLineDash([edge * 4, edge * 3]);
      context.strokeRect(box.x, box.y, box.width, box.height);
      context.restore();
      return;
    }

    // Everything else, as the mark it is about to be. Through the same painter,
    // with the ink it will land with, so letting go changes nothing on screen.
    paintAnnotations(context, frame, [newAnnotation("drawing", drawing.kind, drawing.points, ink)]);
  }, [annotations, drawing, frame, ink]);

  return (
    <canvas
      ref={canvas}
      // Named by attribute, the same convention `data-panel='inspector'` uses:
      // it is how the gallery's shots find the picture to act on.
      data-panel="marks"
      // Over the composition and the full size of it, so a mark can be drawn
      // anywhere in the frame including the background around the picture.
      //
      // `pointer-events-none` always. See the note at the top of this file:
      // the gestures are the preview's, and a transparent layer that catches
      // presses over the whole picture is a layer that loses them.
      className="pointer-events-none absolute inset-0 block size-full rounded-lg"
    />
  );
}
