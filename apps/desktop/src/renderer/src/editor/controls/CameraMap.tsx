import { useRef, type PointerEvent } from "react";

import type { Size } from "../../../../shared/layout";
import type { CameraShape } from "../../../../shared/project";
import { cn } from "../../lib/cn";

/**
 * Where the camera sits, as a map of the frame.
 *
 * Two sliders could express the same pair of numbers, and did — but a position
 * in a rectangle is not two independent quantities, and nobody thinks about one
 * that way. This shows the frame at its real proportions with the bubble in it,
 * so the answer to "where will it be" is the picture rather than two
 * percentages that have to be imagined together.
 *
 * The bubble carries its real shape and its real size, which is why switching a
 * 16:9 frame to 9:16 visibly moves it: the map changes shape with the output.
 */

/** Where the preset dots sit, as fractions of the frame. */
const STOPS = [0.15, 0.5, 0.85];

/**
 * Border radius per shape.
 *
 * A percentage on a non-square box is resolved per axis, which turns a circle
 * into an ellipse — right for the round shapes, and why `wide` uses a length
 * instead: its corners should look the same size on both edges.
 */
const RADIUS: Record<CameraShape, string> = {
  circle: "50%",
  squircle: "28%",
  rounded: "18%",
  wide: "4px",
};

export function CameraMap({
  frame,
  shape,
  size,
  aspect,
  radius,
  x,
  y,
  disabled,
  onChange,
}: {
  frame: Size;
  shape: CameraShape;
  /** Bubble height, as a fraction of the frame's shorter edge. */
  size: number;
  /** How much wider than tall the bubble is. 1 for every shape but `wide`. */
  aspect: number;
  /**
   * Overrides the shape's own radius.
   *
   * For the zoom area, which is not a camera bubble and has no shape of its
   * own: the percentage radii above are resolved per axis, so on a box as wide
   * as a 16:9 frame they stretch the corners into quarter-ellipses. A length
   * keeps them the same size on both edges, which is what a rounded rectangle
   * is meant to look like.
   */
  radius?: string;
  x: number;
  y: number;
  disabled?: boolean;
  onChange: (x: number, y: number) => void;
}) {
  const map = useRef<HTMLDivElement>(null);
  /** Offset from the bubble's centre to where it was picked up, in fractions. */
  const grab = useRef<{ x: number; y: number } | null>(null);

  // As a fraction of each axis rather than of the shorter edge, because the map
  // is not square: a bubble 22% of a 1080-tall frame is 22% of this map's height
  // and only 12% of its width.
  const shorter = Math.min(frame.width, frame.height);
  const height = (size * shorter) / frame.height;
  const width = (size * shorter * aspect) / frame.width;

  // Clamped exactly as `cameraRect` clamps it, so the map cannot show the
  // bubble anywhere the frame would not.
  const clamp = (value: number, half: number) => Math.min(Math.max(value, half), 1 - half);
  const at = { x: clamp(x, width / 2), y: clamp(y, height / 2) };

  const pointAt = (event: PointerEvent) => {
    const box = map.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    };
  };

  const move = (point: { x: number; y: number }) => {
    onChange(clamp(point.x, width / 2), clamp(point.y, height / 2));
  };

  return (
    <div
      ref={map}
      className={cn(
        "relative w-full overflow-hidden rounded-md border border-white/10 bg-black/30",
        disabled && "pointer-events-none opacity-40",
      )}
      // The frame's own proportions. Switching the output to vertical reshapes
      // this with it, which is the point: a square map would put the bubble
      // somewhere it is not.
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      onPointerDown={(event) => {
        const point = pointAt(event);
        if (!point) return;

        // Pressing away from the bubble sends it there — the dots cover the
        // nine obvious places, and anywhere else is a click rather than a hunt
        // for a small target.
        const inside =
          Math.abs(point.x - at.x) <= width / 2 && Math.abs(point.y - at.y) <= height / 2;

        grab.current = inside ? { x: point.x - at.x, y: point.y - at.y } : { x: 0, y: 0 };
        if (!inside) move(point);

        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const point = pointAt(event);
        if (!grab.current || !point) return;
        move({ x: point.x - grab.current.x, y: point.y - grab.current.y });
      }}
      onPointerUp={() => {
        grab.current = null;
      }}
    >
      {/* The nine stops. Drawn under the bubble so it passes over them rather
          than being interrupted by them. */}
      {STOPS.map((top) =>
        STOPS.map((left) => {
          const here = Math.abs(at.x - left) < 0.01 && Math.abs(at.y - top) < 0.01;

          // Named once and used twice. A stop is six pixels across with nothing
          // written on it, so the tooltip is the only way to find out what it
          // does without pressing it — and it has to say the same thing the
          // screen reader hears, which two copies of the expression would stop
          // guaranteeing the first time one of them was edited.
          const name = `Move to ${top === 0.5 ? "middle" : top < 0.5 ? "top" : "bottom"} ${
            left === 0.5 ? "centre" : left < 0.5 ? "left" : "right"
          }`;

          return (
            <button
              key={`${left}-${top}`}
              type="button"
              aria-label={name}
              title={name}
              className={cn(
                "absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
                here ? "bg-white/60" : "bg-white/20 hover:bg-white/40",
              )}
              style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
              onPointerDown={(event) => {
                // Stops the map's own handler treating this as a drag from a
                // point a pixel or two off the dot's centre.
                event.stopPropagation();
                onChange(left, top);
              }}
            />
          );
        }),
      )}

      <div
        className="absolute cursor-grab border-2 border-white/80 bg-white/25 active:cursor-grabbing"
        style={{
          left: `${(at.x - width / 2) * 100}%`,
          top: `${(at.y - height / 2) * 100}%`,
          width: `${width * 100}%`,
          height: `${height * 100}%`,
          borderRadius: radius ?? RADIUS[shape],
        }}
      />
    </div>
  );
}
