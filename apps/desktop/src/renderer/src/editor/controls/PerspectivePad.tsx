import { useRef } from "react";

import { cn } from "../../lib/cn";
import { PerspectivePlate } from "./PerspectivePlate";

/**
 * `rotateX` and `rotateY`, set by dragging a picture of the result.
 *
 * Two sliders and a row of named presets was the previous answer, and the
 * problem with it was not the range: nobody arrives knowing what −8° of pitch
 * against +10° of yaw looks like, so setting an angle meant nudging a number,
 * looking at the preview, and nudging it again.
 *
 * Every 3D tool solves this the same way and has for decades — Blender, Maya
 * and Unity all let you grab the object and turn it, and Rotato does exactly
 * this for device mockups. The control is the thing it controls.
 *
 * Horizontal is `rotateY` and vertical is `rotateX`, because that is the axis
 * each one visibly turns about. The plate inside is drawn with the same rotation the renderer
 * will apply, so what is under the pointer is what the shot will look like.
 */
export function PerspectivePad({
  rotateX,
  rotateY,
  perspective,
  limit,
  onChange,
}: {
  rotateX: number;
  rotateY: number;
  /** 0 to 1. Drives the CSS `perspective` so the plate splays like the shot. */
  perspective: number;
  /** Degrees at the edges, matching what the project will accept. */
  limit: number;
  onChange: (next: { rotateX: number; rotateY: number }) => void;
}) {
  const pad = useRef<HTMLDivElement>(null);

  // Read once per gesture rather than per move: `getBoundingClientRect` inside
  // a pointermove is a layout read on every frame of a drag.
  const box = useRef<DOMRect | null>(null);

  const apply = (event: { clientX: number; clientY: number }) => {
    const rect = box.current;
    if (!rect) return;

    const across = (event.clientX - rect.left) / rect.width;
    const down = (event.clientY - rect.top) / rect.height;

    onChange({
      rotateY: Math.round(clamp((across - 0.5) * 2, -1, 1) * limit),
      // Down on the pad leans the top away, which is what dragging the near
      // edge towards you does to a real plate.
      rotateX: Math.round(clamp((down - 0.5) * 2, -1, 1) * limit),
    });
  };

  // 260px maps the whole range across a pad this size at a comfortable rate;
  // the number only sets how far the plate appears to lean, not the output.
  const perspectivePx = 1400 - perspective * 1100;

  return (
    <div
      ref={pad}
      role="application"
      aria-label="Perspective"
      tabIndex={0}
      className={cn(
        "relative h-24 w-full cursor-grab touch-none overflow-hidden rounded-lg",
        "border border-editor-line bg-black/25 active:cursor-grabbing",
      )}
      onPointerDown={(event) => {
        box.current = event.currentTarget.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        apply(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 0) apply(event);
      }}
      onPointerUp={() => {
        box.current = null;
      }}
      onKeyDown={(event) => {
        // Arrow keys, because a drag-only control is unreachable without a
        // pointer and this is the only way to set an angle now.
        const step = event.shiftKey ? 5 : 1;
        const moves: Record<string, { rotateX: number; rotateY: number }> = {
          ArrowLeft: { rotateX: 0, rotateY: -step },
          ArrowRight: { rotateX: 0, rotateY: step },
          ArrowUp: { rotateX: -step, rotateY: 0 },
          ArrowDown: { rotateX: step, rotateY: 0 },
        };

        const move = moves[event.key];
        if (!move) return;

        event.preventDefault();
        onChange({
          rotateX: clamp(rotateX + move.rotateX, -limit, limit),
          rotateY: clamp(rotateY + move.rotateY, -limit, limit),
        });
      }}
    >
      {/* Centre lines, so flat is findable without reading the numbers. */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />

      <div
        className="absolute inset-0 grid place-items-center"
        style={{ perspective: perspectivePx }}
      >
        <PerspectivePlate
          rotateX={rotateX}
          rotateY={rotateY}
          className="h-12 w-20 rounded-[3px] border border-selected/70 bg-selected/25"
        />
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
