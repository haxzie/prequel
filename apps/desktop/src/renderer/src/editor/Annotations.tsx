/**
 * The drawing surface over a screenshot.
 *
 * A second canvas laid exactly over the composition's, in its own 2D context,
 * and the reason it is separate is the same reason `stillPng.ts` copies before
 * it annotates: one canvas has one context for its life, and the composition's
 * is WebGL.
 *
 * It draws through `paintAnnotations`, which is also what writes the file — so
 * there is one implementation of where a mark sits and what it looks like, and
 * the picture on screen is the picture that is saved. The in-flight stroke goes
 * through the same painter: a drag is drawn as the mark it is about to become
 * rather than as a preview of one, so nothing changes shape when the pointer is
 * let go.
 *
 * Everything here is in the **frame's** own pixels. The canvas is backed at the
 * frame's size × the device ratio and scaled down by CSS, so the context is
 * handed one transform and the marks never learn how big the picture happens to
 * be on screen.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
} from "react";

import type { Annotation, AnnotationKind, Point } from "../../../shared/annotations";
import { annotationHit, annotationRect, newAnnotation } from "../../../shared/annotations";
import { paintAnnotations } from "./annotationPaint";
import type { Size } from "../../../shared/layout";
import type { EditorAction } from "./state";

/**
 * How far from a mark still counts as on it, in CSS pixels of the picture.
 *
 * A 2px arrow needs a target bigger than 2px, and the slack is in screen pixels
 * rather than frame pixels because what matters is how accurately a hand can
 * aim — which does not change when the same picture is shown larger.
 */
const SLACK_PX = 6;

/**
 * The shortest drag that makes a mark, in CSS pixels.
 *
 * Below this it was a click: an arrow of no length draws nothing but still
 * lands in the project as a mark nobody can see or select, which is how a
 * tool comes to look like it has stopped working.
 */
const MIN_DRAG_PX = 6;

/**
 * How far apart freehand samples are kept, in frame pixels.
 *
 * A pointer reports every few milliseconds and a slow hand produces dozens of
 * samples in the same place; left in, they are stored, re-smoothed and
 * re-painted for ever. Dropping anything nearer than this costs nothing
 * visible — the smoothing already runs through the midpoints — and keeps a long
 * stroke to a few hundred points rather than a few thousand.
 */
const SAMPLE_GAP = 2;

/** A drag in progress. */
interface Drawing {
  kind: AnnotationKind;
  points: Point[];
  /** Where it started on screen, so a click can be told from a drag. */
  from: { x: number; y: number };
  moved: boolean;
}

/** A mark being dragged into place, and what it started as. */
interface Moving {
  id: string;
  /** The last pointer position, in fractions — the delta is measured from it. */
  at: Point;
}

export function Annotations({
  frame,
  annotations,
  tool,
  ink,
  selectedId,
  dispatch,
}: {
  /** The output frame in pixels, which is the coordinate space of everything here. */
  frame: Size;
  annotations: readonly Annotation[];
  /** The tool in hand, or null for the pointer — see `EditorState.tool`. */
  tool: AnnotationKind | null;
  /** What a new mark is drawn in. */
  ink: { color: string; width: number };
  selectedId: string | null;
  dispatch: Dispatch<EditorAction>;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /**
   * The drag in flight, in a ref *and* in state.
   *
   * The ref is the truth and the state is what triggers the repaint. Both,
   * because the two readers want different things: the paint effect has to run
   * when the stroke grows, and the pointer handlers have to read and finish the
   * gesture without going through a state updater — dispatching from inside one
   * is a reducer update during another component's render, which React refuses
   * and which left the finished mark unselected.
   */
  const live = useRef<Drawing | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const moving = useRef<Moving | null>(null);

  /** Writes both at once, so they cannot come apart. */
  const setLive = (next: Drawing | null) => {
    live.current = next;
    setDrawing(next);
  };
  /**
   * The canvas's box on screen, measured on entry and on press.
   *
   * Read on every `pointermove` — a hover has to decide which cursor to show —
   * and a layout read next to a paint in the same frame is the thrash this
   * whole file is otherwise careful about. Re-read on press because the picture
   * can be resized by the inspector opening with the pointer never having left
   * it, which is the same reason the composition's canvas re-reads.
   */
  const box = useRef<DOMRect | null>(null);

  /**
   * The ring on the selected mark, in CSS pixels of the picture.
   *
   * React state rather than drawn into the canvas, because it is chrome and not
   * part of the picture: drawn into the canvas it would be written into the
   * exported PNG, which is the one thing a selection must never do.
   */
  const [ring, setRing] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

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

    // The drag, as the mark it is about to be. Through the same painter, with
    // the ink it will land with, so letting go changes nothing on screen.
    if (drawing && drawing.points.length >= 2) {
      paintAnnotations(context, frame, [
        newAnnotation("drawing", drawing.kind, drawing.points, ink),
      ]);
    }
  }, [annotations, drawing, frame, ink]);

  // The ring follows the selection and the frame. Off entirely with a tool in
  // hand: the next gesture draws something new, so a ring on the last mark
  // would be pointing at what the gesture is *not* about to act on.
  useEffect(() => {
    const mark = selectedId === null ? undefined : annotations.find((one) => one.id === selectedId);
    if (!mark || tool !== null) return setRing(null);

    const rect = annotationRect(frame, mark);
    setRing({
      left: (rect.x / frame.width) * 100,
      top: (rect.y / frame.height) * 100,
      width: (rect.width / frame.width) * 100,
      height: (rect.height / frame.height) * 100,
    });
  }, [annotations, selectedId, frame, tool]);

  // Escape puts the tool down, then clears the selection — in that order,
  // because they are two states and one press should undo one of them. On the
  // window rather than the canvas: the toolbar and the inspector are where the
  // hands are between gestures, so this surface rarely has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (tool !== null) dispatch({ type: "pickTool", tool: null });
        else if (selectedId !== null) dispatch({ type: "selectAnnotation", annotationId: null });
        return;
      }

      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (selectedId === null) return;
      // Not while something is being typed into. The caption editor and the
      // text panel are both a keystroke away, and a Backspace that deleted an
      // arrow instead of a character would be unrecoverable by the same key.
      const focused = document.activeElement;
      if (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      dispatch({ type: "deleteAnnotation", annotationId: selectedId });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, selectedId, tool]);

  /** Where a pointer is, as fractions of each edge. */
  const fractionAt = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = box.current ?? event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  /** The same point in frame pixels, for hit testing. */
  const framePoint = (point: Point) => ({ x: point.x * frame.width, y: point.y * frame.height });

  /** How much slack a hit test gets, in frame pixels. */
  const slack = () => {
    const rect = box.current;
    return rect && rect.width > 0 ? (SLACK_PX / rect.width) * frame.width : SLACK_PX;
  };

  /** The topmost mark under a point, or null. Last drawn is first hit. */
  const markAt = (point: Point): Annotation | null => {
    const at = framePoint(point);
    const reach = slack();
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
      const mark = annotations[index]!;
      if (annotationHit(frame, mark, at, reach)) return mark;
    }
    return null;
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    box.current = event.currentTarget.getBoundingClientRect();
    const point = fractionAt(event);

    if (tool === null) {
      const mark = markAt(point);
      dispatch({ type: "selectAnnotation", annotationId: mark?.id ?? null });
      if (!mark) return;

      // A fresh gesture, so this drag gets its own undo entry rather than
      // joining the previous one's — see `beginEdit`.
      dispatch({ type: "beginEdit" });
      moving.current = { id: mark.id, at: point };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // A tool in hand. Both shapes start the same way: a two-point kind moves its
    // second point as the drag goes, and a stroke appends to it.
    setLive({
      kind: tool,
      points: [point, point],
      from: { x: event.clientX, y: event.clientY },
      moved: false,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = fractionAt(event);

    const dragging = moving.current;
    if (dragging) {
      dispatch({
        type: "moveAnnotation",
        annotationId: dragging.id,
        by: { x: point.x - dragging.at.x, y: point.y - dragging.at.y },
      });
      // The reference moves with the pointer, so the next move is a delta from
      // here rather than from the press — which would apply the whole offset
      // again on every event and run the mark off the frame.
      moving.current = { id: dragging.id, at: point };
      return;
    }

    const current = live.current;
    if (!current) return;

    const moved =
      current.moved ||
      Math.hypot(event.clientX - current.from.x, event.clientY - current.from.y) >= MIN_DRAG_PX;

    if (current.kind !== "pen") {
      setLive({ ...current, moved, points: [current.points[0]!, point] });
      return;
    }

    // A stroke, thinned as it is taken. See `SAMPLE_GAP`.
    const last = current.points[current.points.length - 1]!;
    const gap = Math.hypot((point.x - last.x) * frame.width, (point.y - last.y) * frame.height);
    if (gap < SAMPLE_GAP) {
      if (moved !== current.moved) setLive({ ...current, moved });
      return;
    }

    setLive({ ...current, moved, points: [...current.points, point] });
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    moving.current = null;

    const current = live.current;
    setLive(null);

    // A click rather than a drag. Nothing is made: a mark with no length is one
    // nobody can see or select, and leaving one in the project reads as the
    // tool having stopped working.
    if (!current?.moved) return;

    dispatch({ type: "addAnnotation", kind: current.kind, points: current.points });
    // The tool is put down once it has drawn, so the mark can be nudged and
    // recoloured straight away. Drawing three arrows is three presses of the
    // tool, which is the trade: the alternative leaves somebody who has
    // finished drawing unable to click anything without drawing again.
    dispatch({ type: "pickTool", tool: null });
  };

  return (
    <>
      <canvas
        ref={canvas}
        // Named by attribute for the documentation screenshots, which drag
        // across it — the same convention `data-panel='inspector'` uses.
        data-panel="marks"
        // Over the composition and the full size of it, so a mark can be drawn
        // anywhere in the frame including the background around the picture.
        className="absolute inset-0 block size-full rounded-lg"
        style={{
          // Crosshair with a tool in hand, the arrow without one — which is the
          // only indication on the picture itself of which mode this is in.
          cursor: tool === null ? "default" : "crosshair",
          // The pointer is only taken when there is something here to do with
          // it. Without this the surface would eat every press meant for the
          // composition underneath — the camera's drag handles, the picture's
          // own hit testing — for the sake of a layer that is usually empty.
          //
          // A mark to select counts: with no tool and no marks there is nothing
          // this layer could answer, and the clip underneath should get the
          // press.
          pointerEvents: tool !== null || annotations.length > 0 ? "auto" : "none",
        }}
        onPointerEnter={(event) => {
          box.current = event.currentTarget.getBoundingClientRect();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* In percentages of the picture rather than pixels, so it tracks the
          preview being resized without this component measuring anything: the
          box it sits in is already the picture's size. */}
      {ring && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[3px] border border-selected/90 bg-selected/10"
          style={{
            left: `${String(ring.left)}%`,
            top: `${String(ring.top)}%`,
            width: `${String(ring.width)}%`,
            height: `${String(ring.height)}%`,
          }}
        />
      )}
    </>
  );
}
