import { useRef, useState } from "react";

import { easeAt } from "../../../../shared/layout";
import { cn } from "../../lib/cn";

/**
 * The zoom's easing, set by dragging the curve itself.
 *
 * The same argument `PerspectivePad` makes: nobody arrives knowing what a
 * control point at (0.8, 0) feels like, so the control is a picture of the
 * result. This one is the curve every motion tool draws — After Effects, Figma
 * and the browser's own devtools all show a cubic bézier with two handles — so
 * it needs no explaining to anyone who has shaped an ease before.
 *
 * One control for both ends rather than two sliders. The first handle governs
 * how the move leaves rest and the second how it settles, which is exactly what
 * "entry" and "exit" mean here; separating them into two controls would hide the
 * one thing that matters, which is the shape they make together.
 *
 * Time runs left to right and the zoom's progress upwards, so the curve reads the
 * way the move happens: flat means holding still, steep means travelling.
 */
export function EasingPad({
  curve,
  onChange,
}: {
  curve: { easeInX: number; easeInY: number; easeOutX: number; easeOutY: number };
  onChange: (next: Partial<typeof curve>) => void;
}) {
  /**
   * The plot itself, inset from the pad's edge.
   *
   * Measured instead of the pad, and inset for a reason worth stating: a handle
   * at 0 or 1 sits exactly on the boundary, and centred on it half the dot falls
   * outside and is clipped away. Every preset puts at least one handle on an end,
   * so without the inset the control ships with its handles half missing.
   */
  const plot = useRef<HTMLDivElement>(null);
  // Read once per gesture rather than per move: `getBoundingClientRect` inside a
  // pointermove is a layout read on every frame of a drag.
  const box = useRef<DOMRect | null>(null);
  /** Which handle the current drag grabbed, or null between drags. */
  const held = useRef<"in" | "out" | null>(null);
  const [active, setActive] = useState<"in" | "out" | null>(null);

  /** y is inverted: the plot's top is progress 1, and screens count downwards. */
  const toPad = (x: number, y: number) => ({
    left: `${String(x * 100)}%`,
    top: `${String((1 - y) * 100)}%`,
  });

  const nearest = (across: number, down: number): "in" | "out" => {
    const value = 1 - down;
    const toIn = Math.hypot(across - curve.easeInX, value - curve.easeInY);
    const toOut = Math.hypot(across - curve.easeOutX, value - curve.easeOutY);
    return toIn <= toOut ? "in" : "out";
  };

  const apply = (event: { clientX: number; clientY: number }) => {
    const rect = box.current;
    const handle = held.current;
    if (!rect || !handle) return;

    const across = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    // The same unit square the project clamps to, so the pad cannot express a
    // curve that is then quietly altered on the way to disk.
    const value = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);

    if (handle === "in") onChange({ easeInX: across, easeInY: value });
    else onChange({ easeOutX: across, easeOutY: value });
  };

  // Sampled rather than expressed as an SVG cubic: the path has to be the curve
  // the *renderer* will use, and that is `easeAt` — including its x inversion.
  // A `C` command would draw the bézier's own parametrisation, which is a
  // subtly different line, and the control would be lying about the result.
  const path = Array.from({ length: 49 }, (_, step) => {
    const t = step / 48;
    return `${String(t * 100)},${String((1 - easeAt(curve, t)) * 100)}`;
  }).join(" ");

  return (
    <div
      role="application"
      aria-label="Easing"
      className={cn(
        "relative h-28 w-full touch-none overflow-hidden rounded-lg",
        "border border-editor-line bg-black/25",
      )}
      onPointerDown={(event) => {
        const rect = plot.current?.getBoundingClientRect();
        if (!rect) return;
        box.current = rect;
        held.current = nearest(
          (event.clientX - rect.left) / rect.width,
          (event.clientY - rect.top) / rect.height,
        );
        setActive(held.current);
        event.currentTarget.setPointerCapture(event.pointerId);
        apply(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 0) apply(event);
      }}
      onPointerUp={() => {
        box.current = null;
        held.current = null;
        setActive(null);
      }}
    >
      {/* Inset by a handle's radius plus a little, so a control point on any
          edge is drawn whole. The plot is what the drag is measured against, so
          the inset costs no range — the full curve still spans it. */}
      <div ref={plot} className="absolute inset-[7px]">
        {/* The straight line from rest to arrival. Linear is the one shape worth
          being able to find without reading numbers, and it also says which
          way the curve is bending. */}
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            x1="0"
            y1="100"
            x2="100"
            y2="0"
            stroke="currentColor"
            strokeWidth="0.5"
            className="text-white/10"
          />

          {/* Handle arms, drawn first so the curve sits on top of them. */}
          <line
            x1="0"
            y1="100"
            x2={curve.easeInX * 100}
            y2={(1 - curve.easeInY) * 100}
            stroke="currentColor"
            strokeWidth="0.5"
            className="text-selected/40"
          />
          <line
            x1="100"
            y1="0"
            x2={curve.easeOutX * 100}
            y2={(1 - curve.easeOutY) * 100}
            stroke="currentColor"
            strokeWidth="0.5"
            className="text-selected/40"
          />

          {/* `vectorEffect` so the stroke stays even: the viewBox is stretched to
            the pad's shape by `preserveAspectRatio="none"`, which would
            otherwise squash the line's width along with it. */}
          <polyline
            points={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="text-selected"
          />
        </svg>

        <Handle at={toPad(curve.easeInX, curve.easeInY)} label="Entry" held={active === "in"} />
        <Handle at={toPad(curve.easeOutX, curve.easeOutY)} label="Exit" held={active === "out"} />
      </div>

      {/* Which end is which. Inside the pad rather than under it: the axis only
          means anything next to the curve it describes. */}
      <span className="pointer-events-none absolute bottom-1 left-1.5 text-[9px] leading-none text-editor-muted">
        in
      </span>
      <span className="pointer-events-none absolute top-1 right-1.5 text-[9px] leading-none text-editor-muted">
        out
      </span>
    </div>
  );
}

/** One control point. Grabbed by proximity, so the dot itself need not be hit. */
function Handle({
  at,
  label,
  held,
}: {
  at: { left: string; top: string };
  label: string;
  held: boolean;
}) {
  return (
    <span
      aria-label={label}
      className={cn(
        "pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
        "border border-white/70 transition-colors",
        held ? "bg-white" : "bg-selected",
      )}
      style={at}
    />
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
