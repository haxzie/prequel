import type { ReactNode } from "react";

import { useRef } from "react";

import { cn } from "../../lib/cn";

/**
 * A number, as a dial.
 *
 * The panel these live in is otherwise a column of horizontal fills, and the
 * three things it holds that are not lengths — a pitch, a yaw and how hard the
 * perspective is sold — read as one more padding or opacity when they are drawn
 * as one more bar. Side by side as dials they say the other thing: one object,
 * measured three ways.
 *
 * **Dragged along one axis, not round.** A dial invites a rotary grab and it is
 * the wrong gesture here: the angles span a quarter turn at most, so a pointer
 * that sets the value from its bearing about the centre swings it the length of
 * the range the instant it crosses the middle — and on a control this small the
 * pointer is near the middle for most of a drag.
 *
 * Which axis is `axis`, and for the angles it is not a preference. A pitch is
 * read by dragging the near edge of the picture towards you and a yaw by
 * swinging its far edge across — so the gesture that sets each one is the
 * gesture that would turn a real plate that way. A dial that took both would be
 * two meanings on one pointer, and a diagonal drag would set a value nobody
 * aimed at.
 */
export function Dial({
  label,
  icon,
  axis,
  value,
  min,
  max,
  origin = 0,
  step = 1,
  format,
  overridden,
  disabled,
  onChange,
}: {
  /** The word under the dial, and what a screen reader is told it sets. */
  label: string;
  /**
   * Beside the reading, inside the dial.
   *
   * Dials side by side are the same circle over again, and the words under them
   * are below the thing being dragged rather than on it — so at a glance, with
   * the pointer over one of them, there is nothing in the control itself to say
   * which it is. The glyph is that.
   */
  icon: ReactNode;
  /** Which way the drag and the arrow keys run. */
  axis: "vertical" | "horizontal";
  value: number;
  min: number;
  max: number;
  /**
   * What the arc is measured from, and where a double-click puts the value
   * back to.
   *
   * The middle of the range for an angle, which is flat; the bottom of it for a
   * depth, which has no other side to lean to. It is what makes one control
   * serve both: a signed dial sweeps either way from twelve o'clock, and an
   * unsigned one only ever fills clockwise.
   */
  origin?: number;
  /** The smallest change a drag or an arrow key can make. */
  step?: number;
  /** How the value reads to a person — a fraction is not a useful number. */
  format: (value: number) => string;
  /** True when the selected slice sets this itself rather than inheriting. */
  overridden?: boolean;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const sideways = axis === "horizontal";

  // Where the drag began, and what the value was there. Accumulating from the
  // start rather than from the last move is what keeps a slow drag from
  // drifting: rounding each step to a whole degree and adding them up loses a
  // fraction every frame, so the pointer and the reading come apart.
  const from = useRef<{ at: number; value: number } | null>(null);

  const apply = (event: { clientX: number; clientY: number }) => {
    const start = from.current;
    if (!start) return;

    // Rightwards and upwards both count as positive. Up is the obvious one;
    // right is chosen to match it rather than to match the picture, because a
    // yaw's sign is already a choice and two controls that disagreed about
    // which way is "more" would be the thing worth avoiding.
    const travelled = sideways ? event.clientX - start.at : start.at - event.clientY;
    const moved = start.value + (travelled * (max - min)) / DRAG_PX;
    onChange(clamp(Math.round(moved / step) * step, min, max));
  };

  // How far round the rim the arc has swept, as a fraction of a half turn.
  //
  // The range, not the value. Drawn at true scale a 12° tilt is a stub barely
  // off the top of the dial and every useful setting looks like every other
  // one; this is a gauge of how far through the range the value is, which is
  // what somebody turning it is actually judging.
  //
  // The whole range is one whole turn, measured from `origin` — which is the
  // rule that makes a signed dial and an unsigned one the same picture. An
  // angle spends half a turn either side of flat and uses the ring between
  // them; a depth spends all of it going one way and uses the same ring.
  //
  // Per *side* was the first attempt and it was wrong in a way that only shows
  // on the unsigned one: a depth at its maximum had filled a semicircle and
  // stopped, because the control was giving its one side the half turn an
  // angle gets for each of two.
  const span = max - min;
  const sweep = span > 0 ? ((value - origin) / span) * 360 : 0;

  return (
    <div className={cn("flex flex-col items-center gap-1.5", disabled && "opacity-40")}>
      <div
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={format(value)}
        aria-orientation={sideways ? "horizontal" : "vertical"}
        tabIndex={disabled ? -1 : 0}
        title={`Drag ${sideways ? "left and right" : "up and down"}. Double-click to reset.`}
        className={cn(
          "relative size-16 touch-none rounded-full outline-none",
          // The hairline every surface in this editor is edged with, over the
          // slider's own track colour — so a dial reads as the same family of
          // control as the bars above it, and as something with a rim to turn
          // rather than a disc lying on the panel.
          "border border-editor-line bg-white/5",
          "focus-visible:ring-1 focus-visible:ring-selected",
          disabled ? "cursor-default" : sideways ? "cursor-ew-resize" : "cursor-ns-resize",
        )}
        onPointerDown={(event) => {
          if (disabled) return;
          from.current = { at: sideways ? event.clientX : event.clientY, value };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 0) apply(event);
        }}
        onPointerUp={() => {
          from.current = null;
        }}
        // Back to the origin. The row of named angles this replaced was the only
        // way to get back to nothing in one gesture, and a dial left at −37° is
        // exactly the moment somebody wants it: the panel's Reset is a bigger
        // hammer, since it puts every other dial back as well.
        onDoubleClick={() => {
          if (!disabled) onChange(origin);
        }}
        onKeyDown={(event) => {
          // The same two arrows the drag runs along, so the keyboard and the
          // pointer are one control rather than two. Shift for five steps,
          // which is what the pad this replaced moved by.
          const by = event.shiftKey ? step * 5 : step;
          const up = sideways ? "ArrowRight" : "ArrowUp";
          const down = sideways ? "ArrowLeft" : "ArrowDown";
          const to = event.key === up ? value + by : event.key === down ? value - by : null;
          if (to === null) return;
          event.preventDefault();
          // Back onto the step grid, because a value nudged from one that is
          // already off it — a project written before the step was this fine —
          // would stay off it for ever.
          onChange(clamp(Math.round(to / step) * step, min, max));
        }}
      >
        <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
          {/* The rim, as marks rather than a second ring. What says this one
              turns: a bordered disc on its own is a button, and the comb gives
              the arc below something to be measured against. */}
          {TICKS.map((at) => (
            <line
              key={at}
              x1={50 + Math.sin(at) * 45}
              y1={50 - Math.cos(at) * 45}
              x2={50 + Math.sin(at) * 40}
              y2={50 - Math.cos(at) * 40}
              className="stroke-white/20"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))}

          {/* From twelve o'clock, whichever way the value went. Nothing at all
              at flat: an arc of zero length still paints its round cap, which
              is a dot sitting at the top of a dial that is set to nothing. */}
          {Math.abs(sweep) >= WHOLE ? (
            <circle
              cx={50}
              cy={50}
              r={RING}
              className="stroke-selected"
              strokeWidth={4}
              fill="none"
            />
          ) : (
            Math.abs(sweep) > 0.5 && (
              <path
                d={arc(sweep)}
                className="stroke-selected"
                strokeWidth={4}
                strokeLinecap="round"
                fill="none"
              />
            )
          )}
        </svg>

        <span
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center gap-0.5",
            "text-[11px] tabular-nums",
            overridden ? "font-medium text-white" : "text-white/80",
          )}
        >
          {/* Dimmer than the number beside it. The reading is what the dial is
              for and the glyph only says which dial this is, so at one weight
              the two competed and the pair read as a label with a value rather
              than a value with a hint. */}
          <span className="flex-none text-white/45 [&_svg]:size-3" aria-hidden>
            {icon}
          </span>
          {format(value)}
        </span>
      </div>

      <span
        className={cn(
          "text-[11px]",
          overridden ? "font-medium text-editor-fg" : "text-editor-muted",
        )}
        title={overridden ? "Set for this clip" : undefined}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * How far the pointer travels to cross the whole range, in pixels.
 *
 * The dial is 64px across, so a one-to-one mapping would put the entire range
 * inside the control itself and every drag would slam into an end. Wider than
 * the control on purpose.
 */
const DRAG_PX = 180;

/** Where the rim's marks sit, in radians from twelve o'clock. */
const TICKS = Array.from({ length: 36 }, (_, index) => (index / 36) * 2 * Math.PI);

/**
 * How far out the value arc sits, in the SVG's own hundred-unit box.
 *
 * Just inside the tick comb, so the arc reads against the marks rather than
 * floating in the middle of the disc.
 */
const RING = 42.5;

/**
 * Past this the arc is drawn as a ring instead.
 *
 * An arc whose end lands on its own start is a zero-length path: SVG draws
 * nothing at all for it. So a depth dragged to its maximum went blank — the one
 * value where the control had most to say. Short of a full turn by half a
 * degree, which is under a pixel at this size.
 */
const WHOLE = 359.5;

/**
 * The value arc, from twelve o'clock round by `degrees`.
 *
 * Written out rather than stroked onto a circle with a dash array, because a
 * dash offset cannot run anticlockwise: a negative angle would have to be drawn
 * as the complement of a positive one and would sweep the wrong way round the
 * rim, which is the one thing the arc is there to say.
 */
function arc(degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  const x = 50 + Math.sin(radians) * RING;
  const y = 50 - Math.cos(radians) * RING;
  // Which way round the long way is. An unsigned dial past its halfway point
  // sweeps more than a half turn, and without this it takes the short way back
  // and draws the part of the ring that is *not* set.
  const long = Math.abs(degrees) > 180 ? 1 : 0;
  return `M 50 ${String(50 - RING)} A ${String(RING)} ${String(RING)} 0 ${String(long)} ${
    degrees > 0 ? 1 : 0
  } ${String(x)} ${String(y)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
