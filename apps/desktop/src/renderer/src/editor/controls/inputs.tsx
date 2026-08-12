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
  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-40")}>
      <input
        type="range"
        className="h-1 flex-1 appearance-none rounded-full bg-white/10 accent-editor-accent enabled:cursor-pointer"
        disabled={disabled}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
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
  onChange,
}: {
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
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
