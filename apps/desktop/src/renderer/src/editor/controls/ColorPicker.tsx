import { useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { hexToHsv, hsvToHex } from "./colour";

/** The rainbow the hue strip is painted with, and the strip's own thumb track. */
const HUES = [0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${String(h)} 100% 50%)`).join(", ");

/**
 * A saturation/value square under a hue strip.
 *
 * Hand-drawn rather than `input[type=color]`, which opens the system panel — a
 * full-screen macOS window with tabs, sliders and an eyedropper, over an editor
 * whose whole inspector is 320 pixels of flat dark chrome. It also cannot be
 * styled: the two vendor pseudo-elements reach the swatch and nothing else.
 *
 * Inline rather than floating. The panel is `overflow-hidden` with a scrolling
 * column inside it, so a popover would be clipped at the panel's edge unless it
 * were portalled to the body and then kept in place against scroll and resize.
 * Opening in the flow costs a push of the controls below and nothing else.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { h, s, v } = hexToHsv(value);

  // The hue a grey came from. Saturation and value can both reach zero, and at
  // either end the hue is gone — dragging into the black corner and back out
  // would otherwise return red rather than the colour that was being edited.
  // Written during render because it is a cache of what was just read, not
  // state anything renders from.
  const held = useRef(h);
  if (s > 0.001 && v > 0.001) held.current = h;
  const hue = s > 0.001 && v > 0.001 ? h : held.current;

  return (
    <div className="flex flex-col gap-2">
      <Area hue={hue} s={s} v={v} onChange={(next) => onChange(hsvToHex({ ...next, h: hue }))} />
      <Strip hue={hue} onChange={(next) => onChange(hsvToHex({ h: next, s: s || 1, v: v || 1 }))} />
    </div>
  );
}

/**
 * Drags a value out of a box, in fractions of it.
 *
 * The rectangle is read once on press rather than per move, the way the pads
 * do: `getBoundingClientRect` inside a pointermove is a layout read on every
 * frame of a drag, and neither of these can move while one is in flight.
 */
function useDrag(onMove: (x: number, y: number) => void) {
  const box = useRef<DOMRect | null>(null);

  const at = (event: { clientX: number; clientY: number }) => {
    const rect = box.current;
    if (!rect) return;
    onMove(
      Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    );
  };

  return {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      box.current = event.currentTarget.getBoundingClientRect();
      event.currentTarget.setPointerCapture(event.pointerId);
      at(event);
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) at(event);
    },
    onPointerUp: () => {
      box.current = null;
    },
  };
}

/** The thumb both surfaces are marked with. */
const THUMB =
  "pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full " +
  "border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]";

function Area({
  hue,
  s,
  v,
  onChange,
}: {
  hue: number;
  s: number;
  v: number;
  onChange: (next: { s: number; v: number }) => void;
}) {
  const drag = useDrag((x, y) => onChange({ s: x, v: 1 - y }));

  return (
    <div
      role="application"
      aria-label="Saturation and brightness"
      className="relative h-28 w-full cursor-crosshair touch-none overflow-hidden rounded-md"
      // White to the hue across, then black up from the bottom. Two layers
      // rather than one: it is the standard construction, and it means the hue
      // is the only thing that changes when the strip moves.
      style={{
        backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${String(Math.round(hue))} 100% 50%))`,
      }}
      {...drag}
    >
      <span
        className={THUMB}
        style={{
          left: `${String(s * 100)}%`,
          top: `${String((1 - v) * 100)}%`,
          backgroundColor: hsvToHex({ h: hue, s, v }),
        }}
      />
    </div>
  );
}

function Strip({ hue, onChange }: { hue: number; onChange: (hue: number) => void }) {
  const drag = useDrag((x) => onChange(x * 360));

  return (
    <div
      role="application"
      aria-label="Hue"
      className="relative h-3 w-full cursor-ew-resize touch-none rounded-full"
      style={{ backgroundImage: `linear-gradient(to right, ${HUES})` }}
      {...drag}
    >
      <span
        className={cn(THUMB, "top-1/2")}
        style={{
          left: `${String((hue / 360) * 100)}%`,
          backgroundColor: `hsl(${String(Math.round(hue))} 100% 50%)`,
        }}
      />
    </div>
  );
}
