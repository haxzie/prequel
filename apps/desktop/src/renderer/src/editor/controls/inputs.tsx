import type { ReactNode } from "react";

import { useState } from "react";

import { cn } from "../../lib/cn";

/**
 * The inspector's four controls.
 *
 * Composed from utilities rather than pulled from a component library — the
 * editor needs about thirty instances of these four and nothing else, and a
 * dependency for that would be a poor trade.
 */

/**
 * A value as a filled bar.
 *
 * The fill *is* the handle: its leading edge is what you drag, and the grip
 * line sits just inside it. There is no separate thumb, which is what lets the
 * control be this tall — a circle riding a hairline has to stay small to look
 * like anything, and a small target is a fiddly one.
 *
 * Built from elements with the range input laid transparently over them, rather
 * than from `::-webkit-slider-thumb`. The thumb pseudo-element cannot be the
 * end of the track, and the track pseudo-element cannot contain anything, so
 * this shape is not expressible in either.
 */
export function Slider({
  value,
  min,
  max,
  step = 0.001,
  format,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** How the value reads to a person — a fraction is not a useful number. */
  format?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / Math.max(max - min, 1e-9)) * 100;

  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-40")}>
      <div className="group relative h-5 flex-1 overflow-hidden rounded-md bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-md bg-white transition-[width] duration-75"
          // A floor, so the fill keeps its rounded end at zero instead of
          // collapsing into a sliver against the left edge.
          style={{ width: `max(0.75rem, ${fill}%)` }}
        >
          {/* Inside the fill rather than on top of the boundary: on white it is
              always legible, and it is the only part of a bar this plain that
              says it can be dragged. Green on hover — the grip is the thing
              being reached for, so it is the thing that should answer. */}
          <span
            className={cn(
              "absolute top-1/2 right-1.5 h-2.5 w-0.5 -translate-y-1/2 rounded-full transition-colors",
              disabled ? "bg-editor-bg/40" : "bg-editor-bg/40 group-hover:bg-toggle",
            )}
          />
        </div>

        <input
          type="range"
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0 disabled:cursor-default"
          disabled={disabled}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>

      <span className="w-10 flex-none text-right text-[11px] tabular-nums text-editor-muted">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  disabled,
  iconsOnly,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string; icon?: ReactNode }[];
  disabled?: boolean;
  /** Drop the labels. For a row of shapes, where the glyph *is* the answer and
      the words only repeat it — the name still reaches a screen reader and the
      tooltip. */
  iconsOnly?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className={cn("flex gap-0.5 rounded-lg bg-white/5 p-0.5", disabled && "opacity-40")}
      role="radiogroup"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          disabled={disabled}
          title={option.title ?? option.label}
          className={cn(
            // The icon sits beside the label rather than replacing it: a glyph
            // alone has to be learned, and a label alone makes every option in
            // the panel look the same at a glance.
            "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1",
            "text-[11px] whitespace-nowrap [&_svg]:size-3.5",
            option.value === value
              ? // Dark text on the light accent: white on it would be unreadable,
                // which is the trade for an accent this light.
                "bg-editor-accent font-medium text-editor-bg"
              : "text-editor-muted hover:bg-white/10 hover:text-editor-fg",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {!iconsOnly && option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One row of destinations, marked underneath.
 *
 * A segmented control is for a value — the three camera shapes are all applied,
 * and the pill shows which one is. These are not: pressing Solid changes what
 * the panel is showing, and nothing about the frame until a swatch is pressed.
 * A pill lit up on Solid over an image background says the background is a
 * colour, which is the one thing it must not say.
 *
 * The underline overlaps the row's own line rather than sitting under it, so
 * the marked tab reads as a piece cut out of the rule instead of as a second
 * line below it.
 */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-4 border-b border-editor-line" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          title={option.title ?? option.label}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 pb-1.5",
            "text-[11px] whitespace-nowrap [&_svg]:size-3.5",
            option.value === value
              ? "border-editor-accent font-medium text-editor-fg"
              : "border-transparent text-editor-muted hover:text-editor-fg",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A switch, always at the right-hand end of its row.
 *
 * Green when on, white knob either way. Green because "on" is the one state
 * worth reading across a panel of controls, and a white knob because it has to
 * stay the same object as it slides — a knob that changes colour with the track
 * reads as two different things rather than as one moving.
 */
export function Toggle({
  value,
  disabled,
  title,
  onChange,
}: {
  value: boolean;
  disabled?: boolean;
  /** Why it cannot be moved, for the switches that are sometimes unavailable. */
  title?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      title={title}
      aria-checked={value}
      disabled={disabled}
      className={cn("flex-none", disabled && "opacity-40")}
      onClick={() => onChange(!value)}
    >
      <span
        className={cn(
          "relative block h-4 w-7 rounded-full transition-colors",
          value ? "bg-toggle" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-white transition-[left]",
            value ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

export function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Colour"
        // The native swatch is a rounded rectangle with its own padding; the
        // inset negative margins are what make it fill the well.
        className="size-7 flex-none cursor-pointer rounded-md border border-white/10 bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        aria-label="Colour, as hex"
        className="w-full rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] uppercase outline-none focus:bg-white/10"
        value={draft ?? value}
        // Held as text while being typed: `#1` is not a colour, and committing
        // it would reset the swatch to black mid-keystroke.
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft && /^#[0-9a-f]{6}$/i.test(draft)) onChange(draft.toLowerCase());
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(null);
        }}
      />
    </div>
  );
}

/** A percentage, which is how every fractional setting is shown. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
