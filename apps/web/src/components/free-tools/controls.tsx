"use client";

/**
 * The editor's controls, with the handlers put back.
 *
 * `components/editor-controls.tsx` is a set of pictures: it draws what the app's
 * controls look like when nobody is touching them, and takes a fill rather than
 * a value. These are the same controls as working parts, because the free tools
 * are the only place on the site where a visitor sets something rather than
 * reads about it.
 *
 * Measurements, radii and colours are that file's, so the two read as one
 * product. What is added is everything a real control needs and a picture does
 * not: a native input underneath for the keyboard and for assistive technology,
 * a focus ring, and labels that are actually bound to their inputs.
 *
 * Every one of these must be rendered inside `editor-theme`, which is where the
 * `--editor-*` and `--toggle` variables are given values. Outside it the
 * utilities resolve to nothing and the panel comes out transparent.
 */

import type { ReactNode } from "react";

/** The height every control in a panel stands at. `CONTROL_H` in the app. */
const CONTROL_H = "h-7";

/** The gutter glyph, outside the well. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
      {children}
    </span>
  );
}

/**
 * A value as a filled bar, dragged by a range input laid over it.
 *
 * The input is transparent and absolutely positioned across the whole control
 * rather than hidden: a hidden input is not focusable and a `div` with a
 * pointer handler is not a slider to a screen reader. The visible bar is drawn
 * underneath and the input carries the semantics, which is the only version of
 * this that works with a keyboard.
 */
export function Slider({
  icon,
  label,
  read,
  value,
  min,
  max,
  step,
  onChange,
}: {
  icon?: ReactNode;
  label: string;
  /** How the value reads to a person. A fraction is not a useful number. */
  read: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const fill = (value - min) / (max - min);

  return (
    <div className="flex items-center gap-2">
      {icon ? <Glyph>{icon}</Glyph> : null}

      <div
        className={`relative flex-1 overflow-hidden rounded-full bg-white/5 ${CONTROL_H} has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-selected/70`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/12"
          style={{ width: `max(0.75rem, ${fill * 100}%)` }}
        >
          <span className="absolute top-1/2 right-2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-white/60" />
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-between gap-2 px-2.5 text-[11px]">
          <span className="truncate text-white">{label}</span>
          <span className="flex-none tabular-nums text-white/70">{read}</span>
        </div>

        <input
          type="range"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="absolute inset-0 size-full cursor-ew-resize appearance-none bg-transparent opacity-0 outline-none"
        />
      </div>
    </div>
  );
}

/** The switch itself, drawn as macOS draws one. */
function Knob({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative block h-[18px] w-10 flex-none rounded-full transition-colors ${on ? "bg-toggle" : "bg-white/15"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-3.5 w-6 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform ${on ? "translate-x-3" : ""}`}
      />
    </span>
  );
}

/**
 * A switch on a row of its own.
 *
 * The whole row is the button, not just the switch: in the app a 40 by 18 target
 * beside a label that did nothing was the smallest thing in the panel and the
 * one people missed.
 */
export function Toggle({
  icon,
  label,
  on,
  onChange,
  disabled = false,
  note,
}: {
  icon?: ReactNode;
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  /** A line under the row, for what the switch cannot say on its own. */
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {icon ? <Glyph>{icon}</Glyph> : null}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onChange(!on)}
          className={`flex flex-1 items-center justify-between gap-2 rounded-full px-2.5 text-left transition-colors ${CONTROL_H} hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-selected/70 focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent`}
        >
          <span className="truncate text-[11px] text-white">{label}</span>
          <Knob on={on} />
        </button>
      </div>
      {note ? <p className="pl-6 text-[11px] leading-snug text-editor-muted">{note}</p> : null}
    </div>
  );
}

/** One row of destinations, marked by a pill that slides to the choice. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const at = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const slot = `calc((100% - 0.25rem - ${options.length - 1} * 0.125rem) / ${options.length})`;

  return (
    <div
      className="relative flex gap-0.5 rounded-full bg-white/5 p-0.5"
      role="group"
      aria-label={label}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full bg-white/12 transition-transform duration-200 motion-reduce:transition-none"
        style={{ width: slot, transform: `translateX(calc(${at} * (100% + 0.125rem)))` }}
      />
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={index === at}
          onClick={() => onChange(option.value)}
          className={`relative z-10 flex flex-1 items-center justify-center rounded-full px-2 text-[11px] whitespace-nowrap focus-visible:ring-2 focus-visible:ring-selected/70 focus-visible:outline-none ${CONTROL_H} ${
            index === at ? "font-medium text-editor-fg" : "text-editor-muted hover:text-editor-fg"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A device picker.
 *
 * A native `<select>`, which is the one control here that is not redrawn. The
 * list is whatever is plugged into the machine, it can be long, and the
 * platform's own menu is better at that than anything this file would draw:
 * it scrolls, it filters by typing, and on a phone it is the system wheel.
 */
export function Picker({
  icon,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon ? <Glyph>{icon}</Glyph> : null}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full min-w-0 appearance-none rounded-full bg-white/5 px-2.5 text-[11px] text-white focus-visible:ring-2 focus-visible:ring-selected/70 focus-visible:outline-none disabled:opacity-50 ${CONTROL_H}`}
      >
        {options.map((option) => (
          // Styled for the one case the page cannot reach: a native menu paints
          // its own rows, and on a dark panel an unstyled option is white text
          // on white in several browsers.
          <option key={option.value} value={option.value} className="bg-editor-panel text-white">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A labelled run of controls, the way the app's inspector groups them. */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-mono text-[10px] tracking-[0.14em] text-editor-muted uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

/** The dark rail every control sits in. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="editor-theme flex flex-col gap-5 rounded-2xl bg-editor-panel p-4 ring-1 ring-black/20">
      {children}
    </div>
  );
}
