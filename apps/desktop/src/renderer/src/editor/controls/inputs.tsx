import type { ReactNode } from "react";

import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import { ChevronDownIcon } from "../icons";
import { ScrollFade } from "./ScrollFade";
import { ColorPicker } from "./ColorPicker";

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
/**
 * The height every control in a panel stands at.
 *
 * The slider set it — it has to be tall enough to hold its own label and
 * reading — and the rest follow so a column of mixed controls has one baseline
 * rather than a step at every change of kind.
 */
export const CONTROL_H = "h-7";

/** Past this many intervals a stepped slider is drawn plain — see `levels`. */
const LEVEL_LIMIT = 12;

export function Slider({
  value,
  min,
  max,
  step = 0.001,
  icon,
  label,
  overridden,
  format,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /**
   * Stands outside the track, to its left.
   *
   * Required rather than optional so a slider added later cannot quietly be the
   * one without one — a column of bars where all but one carry a glyph reads as
   * a mistake, and the compiler is a better guard than a review.
   */
  icon: ReactNode;
  /** Rides inside the bar, on the left. */
  label: string;
  /** True when the selected slice sets this itself rather than inheriting. */
  overridden?: boolean;
  /** How the value reads to a person — a fraction is not a useful number. */
  format?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / Math.max(max - min, 1e-9)) * 100;

  // The stops between the ends, when there are few enough to read as stops.
  //
  // A slider whose step divides its range into a handful of levels — captions
  // are one, two or three lines — is a different control from one stepping in
  // hundredths, and the track should say so. Above a dozen intervals the marks
  // stop being landmarks and become a comb, so they are simply not drawn: every
  // slider here is stepped, and most of them step finely enough that this is
  // the branch they take.
  const steps = Math.round((max - min) / step);
  const levels =
    Number.isFinite(steps) && steps >= 2 && steps <= LEVEL_LIMIT
      ? Array.from({ length: steps - 1 }, (_, index) => ((index + 1) / steps) * 100)
      : [];

  return (
    // The label and the reading are inside the bar rather than above and beside
    // it. Three things on two lines became one, and a column of sliders that was
    // label / bar / number, over and over, is now a stack of bars — which is
    // what the panel is actually a list of. Taller than it was to hold them.
    //
    // The icon stands outside the track. Inside it would be a third thing
    // competing for the same strip, and it would slide under the fill and
    // change contrast as the value moved; out here the column of glyphs is
    // fixed, which is what makes it scannable.
    <div className={cn("flex items-center gap-2", disabled && "opacity-40")}>
      <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
        {icon}
      </span>

      <div className={cn("group relative flex-1 overflow-hidden rounded-md bg-white/5", CONTROL_H)}>
        {/* The tabs' own pill, not the solid white this was. White was fine while
          the bar was empty; with words on top of it there is nothing legible to
          write in — and the filled part of a slider and the marked tab of a row
          are the same statement, so they should be the same colour. */}
        {/* Rounded like the track it sits in, so the filled end follows the same
          curve as the rim rather than stopping square inside it. */}
        <div
          className="absolute inset-y-0 left-0 rounded-md bg-white/12 transition-[width] duration-75"
          // A floor, so the fill keeps its rounded end at zero instead of
          // collapsing into a sliver against the left edge.
          style={{ width: `max(0.75rem, ${String(fill)}%)` }}
        >
          {/* Inside the fill, at its leading edge: on a bar this plain it is the
            only part that says it can be dragged. White at rest, where it was
            dark while the fill behind it was solid white. Green on hover — the
            grip is the thing being reached for, so it is the thing that should
            answer. */}
          <span
            className={cn(
              "absolute top-1/2 right-1.5 h-3.5 w-0.5 -translate-y-1/2 rounded-full transition-colors",
              disabled ? "bg-white/40" : "bg-white group-hover:bg-toggle",
            )}
          />
        </div>

        {/* Over the fill, so a mark on the filled side is not swallowed by it, and
          under the words, which are what the row is read by. */}
        {levels.map((at) => (
          <span
            key={at}
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-white/25"
            style={{ left: `${String(at)}%` }}
          />
        ))}

        {/* Over the fill and under the input, so the words never eat a drag. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between gap-2 px-2.5 text-[11px]">
          {/* Overridden fields still say so through the label's weight, the way
            they did when the label was `Field`'s. */}
          <span className={cn("truncate text-white", overridden && "font-medium")}>{label}</span>
          <span className="flex-none tabular-nums text-white/70">
            {format ? format(value) : value.toFixed(2)}
          </span>
        </div>

        <input
          type="range"
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0 disabled:cursor-default"
          aria-label={label}
          disabled={disabled}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
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
  const at = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const travelling = useTravelling(at);

  // The same two pills the tabs carry, with the row's own gap folded into the
  // arithmetic: a slot here is one option *plus* the 2px beside it, so a whole
  // number of slots lands the pill on an option rather than drifting a gap
  // further along at every step.
  const slot = {
    width: `calc((100% - 0.25rem - ${String(options.length - 1)} * 0.125rem) / ${String(options.length)})`,
  };
  const step = (index: number) => `translateX(calc(${String(index)} * (100% + 0.125rem)))`;
  const pill =
    "pointer-events-none absolute inset-y-0.5 left-0.5 rounded-md " +
    "transition-[transform,opacity] ease-out motion-reduce:transition-none";
  const slide = { transitionDuration: `${String(SLIDE_MS)}ms` };

  return (
    <div
      className={cn("relative flex gap-0.5 rounded-lg bg-white/5 p-0.5", disabled && "opacity-40")}
      role="radiogroup"
      onPointerLeave={() => setHovered(null)}
    >
      <span
        aria-hidden
        className={cn(pill, "bg-white/6")}
        style={{
          ...slot,
          ...slide,
          transform: step(hovered ?? at),
          opacity: hovered === null || (hovered === at && !travelling) ? 0 : 1,
        }}
      />
      <span
        aria-hidden
        className={cn(pill, "bg-white/12")}
        style={{ ...slot, ...slide, transform: step(at) }}
      />

      {options.map((option, index) => (
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
            "relative z-10 flex flex-1 items-center justify-center gap-1 rounded-md px-2",
            CONTROL_H,
            "text-[11px] whitespace-nowrap transition-colors [&_svg]:size-3.5",
            option.value === value
              ? "font-medium text-editor-fg"
              : "text-editor-muted hover:text-editor-fg",
          )}
          onPointerEnter={() => setHovered(index)}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {!iconsOnly && option.label}
        </button>
      ))}
    </div>
  );
}

/** How long a mark takes to travel from one destination to the next. */
export const SLIDE_MS = 200;

/**
 * True while the mark is still on its way to `at`.
 *
 * Both marked rows — the background's tabs and the inspector's rail — keep the
 * pointer's own pill up for exactly this long after a press. Without it the
 * hover pill vanishes the moment the choice changes, because the pointer is now
 * over the chosen thing and the chosen thing has its own pill — so the tab
 * under the cursor goes bare for the length of the slide and only fills once
 * the mark lands. Holding it there means something is always under the pointer,
 * and the two pills simply merge as one arrives beneath the other.
 *
 * A timer rather than `transitionend`, which does not fire at all under
 * `prefers-reduced-motion` — there is no transition to end, and the pill would
 * be held up for ever waiting for one.
 */
export function useTravelling(at: number, ms = SLIDE_MS): boolean {
  const [travelling, setTravelling] = useState(false);

  useEffect(() => {
    setTravelling(true);
    const timer = setTimeout(() => setTravelling(false), ms);
    return () => clearTimeout(timer);
  }, [at, ms]);

  return travelling;
}

/**
 * One row of destinations, marked by a pill that slides between them.
 *
 * This used to be marked with an underline, and the reasoning against a pill is
 * worth keeping: a segmented control is for a *value* — the three camera shapes
 * are all applied, and its pill shows which one is. These are not. Pressing
 * Solid changes what the panel is showing and nothing about the frame until a
 * swatch is pressed, so a pill lit up on Solid over an image background must
 * not be read as "the background is a colour".
 *
 * What keeps it honest is the colour. The pill is a neutral lift off the
 * surface, not the blue this app uses everywhere for "this is the one" — the
 * rail beside it, a chosen swatch, a selected clip. Grey says which view you
 * are on; blue would say which value is applied.
 *
 * Two pills, both absolutely positioned and moved by a transform: one follows
 * the choice, one follows the pointer. Sliding rather than fading because the
 * point of the movement is to say the marked tab *became* this one — three
 * separate backgrounds lighting up and going dark says three things where there
 * is one. Equal shares of the row, so a pill is exactly one slot wide and a
 * whole multiple of its own width lands it on another tab.
 */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}) {
  const at = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const travelling = useTravelling(at);

  // The row is padded by `p-1`, so the track the pills run along is that much
  // narrower than the box. One slot is a pill's whole width — see the transform.
  const slot = { width: `calc((100% - 2rem) / ${String(options.length)})` };
  const pill =
    "pointer-events-none absolute inset-y-1 left-4 rounded-md " +
    "transition-[transform,opacity] ease-out motion-reduce:transition-none";
  const slide = { transitionDuration: `${String(SLIDE_MS)}ms` };

  return (
    // `-mx-4` and `-mt-4` cancel the section's own padding, on the assumption
    // this is the first thing in it — which it is at the one place tabs are
    // used. Vertically to sit the row against the header; horizontally so the
    // bar covers the full width as content scrolls beneath it. Inset, a swatch
    // would slide up through the strip of panel either side of it.
    //
    // No rule under the row. The moving pill is what says which tab is which,
    // and a line as well drew a box around a control that is already a band of
    // its own.
    //
    // Sticky against the top of the panel's scroller — which starts below the
    // header, since that sits outside it — so the tabs stay reachable through a
    // long grid of swatches. The *solid* veil, not the translucent one the panel
    // itself uses: content scrolls under this, and at 93% a swatch grid passing
    // beneath showed through as a ghost of itself. `z-20` clears the swatches,
    // which lift to `z-10` on hover to grow past their track.
    <div className="sticky top-0 z-20 -mx-4 -mt-4 bg-editor-veil-solid">
      {/* Below the row rather than at the scroller's top, where the shared one
          sits: these tabs are opaque and pinned over it, so content passing
          under them is cut at *their* underside. Anchored inside the sticky
          wrapper so it travels with them and needs no measurement of how tall
          they are. */}
      <ScrollFade className="absolute inset-x-0 top-full z-10" />
      {/* `px-4` insets the pills from the panel's edges — the rule under them
          still runs the full width, so the row divides the panel while the
          controls in it sit within its margin. It also sets the slot width, and
          with it how wide a pill is: see `slot`. */}
      <div
        className="relative flex px-4 py-1"
        role="tablist"
        onPointerLeave={() => setHovered(null)}
      >
        {/* Parked under the choice while nothing is hovered, so it fades in
            where the pointer is rather than flying in from the first tab. */}
        <span
          aria-hidden
          className={cn(pill, "bg-white/6")}
          style={{
            ...slot,
            ...slide,
            transform: `translateX(calc(${String(hovered ?? at)} * 100%))`,
            opacity: hovered === null || (hovered === at && !travelling) ? 0 : 1,
          }}
        />
        <span
          aria-hidden
          className={cn(pill, "bg-white/12")}
          style={{ ...slot, ...slide, transform: `translateX(calc(${String(at)} * 100%))` }}
        />

        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={option.value === value}
            title={option.title ?? option.label}
            // Above the pills, which are painted behind the whole row.
            className={cn(
              "relative z-10 flex flex-1 items-center justify-center rounded-md py-1",
              // The panel header's size, not the 11px the field labels use:
              // these are the panel's own divisions rather than a label on a
              // control, and at 11px they read as a caption over the thing they
              // switch.
              "text-[13px] whitespace-nowrap transition-colors",
              option.value === value
                ? "font-medium text-editor-fg"
                : "text-editor-muted hover:text-editor-fg",
            )}
            onPointerEnter={() => setHovered(index)}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
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
/**
 * A switch on a row of its own, matching a slider's.
 *
 * The whole row is the button, not just the switch. A 28×16 target beside a
 * label that did nothing was the smallest thing in the panel and the one people
 * missed — everything else here is a bar you can hit anywhere along. The switch
 * is still the part that says what will happen; it is no longer the only part
 * that answers.
 */
export function ToggleField({
  icon,
  label,
  overridden,
  value,
  disabled,
  title,
  onChange,
}: {
  /** Stands outside the well, as it does on a slider. */
  icon: ReactNode;
  label: string;
  /** True when the selected slice sets this itself rather than inheriting. */
  overridden?: boolean;
  value: boolean;
  disabled?: boolean;
  /** Why it cannot be moved, for the switches that are sometimes unavailable. */
  title?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-40")}>
      <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
        {icon}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={value}
        title={title}
        disabled={disabled}
        className={cn(
          "flex flex-1 items-center justify-between gap-2 rounded-md bg-white/5 px-2.5",
          CONTROL_H,
          "text-left disabled:cursor-default",
          !disabled && "hover:bg-white/8",
        )}
        onClick={() => onChange(!value)}
      >
        <span className={cn("truncate text-[11px] text-white", overridden && "font-medium")}>
          {label}
        </span>
        <Switch value={value} />
      </button>
    </div>
  );
}

/**
 * The switch itself, without a row around it.
 *
 * Green when on, white knob either way. Green because "on" is the one state
 * worth reading across a panel of controls, and a white knob because it has to
 * stay the same object as it slides — a knob that changes colour with the track
 * reads as two different things rather than as one moving.
 *
 * Squared off rather than a pill. Everything else in the panel is a rounded
 * rectangle at the same radius — the wells, the cards, the tab pills — and a
 * capsule among them was the one shape drawn from a different set.
 *
 * The two radii are concentric: the knob's is the track's less the gap between
 * them, 6 − 2 = 4. Corners nested any other way have their curves running at
 * different rates through the gap, which reads as a wobble in the space between
 * the two rather than as a mistake in either.
 *
 * Worth knowing that a pill satisfies this too, and trivially: a 9px track
 * around a knob inset by 2 wants a 7px knob, and 7 is exactly half of 14. That
 * is why the capsule looked right — going square is a change of shape, not a
 * correction.
 */
function Switch({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "relative block h-[18px] w-8 flex-none rounded-md transition-colors",
        value ? "bg-toggle" : "bg-white/15",
      )}
      aria-hidden
    >
      <span
        className={cn(
          "absolute top-0.5 size-3.5 rounded bg-white transition-[left]",
          value ? "left-4" : "left-0.5",
        )}
      />
    </span>
  );
}

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
      <Switch value={value} />
    </button>
  );
}

export function ColorField({
  icon,
  label,
  overridden,
  value,
  onChange,
}: {
  /** Stands outside the well, as it does on a slider. */
  icon: ReactNode;
  /**
   * Names the field for a screen reader and nothing else — the well is a
   * swatch, a divider and a hex value, with no room for a word. What it is for
   * is carried by the icon outside it and the group heading above.
   */
  label: string;
  /** True when the selected slice sets this itself rather than inheriting. */
  overridden?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  return (
    // A column: the row, and the picker that drops out of it.
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
          {icon}
        </span>

        <div
          className={cn(
            "flex flex-1 items-stretch overflow-hidden rounded-md bg-white/5",
            CONTROL_H,
            "focus-within:bg-white/10",
          )}
        >
          {/* Opens the app's own picker below rather than the system panel a
              native `input[type=color]` opens — see `ColorPicker`. */}
          <button
            type="button"
            aria-label={`${label}, as a colour`}
            aria-expanded={open}
            className="flex flex-none cursor-pointer items-center gap-1 pr-1.5 pl-2"
            onClick={() => setOpen((was) => !was)}
          >
            <span className="size-4 rounded-[3px]" style={{ backgroundColor: value }} aria-hidden />
            {/* After the swatch, not before it: a chevron leads the eye to what
                it opens, and what opens here is the picker the swatch stands
                for. Turned over once it is open, which is the one thing saying
                the panel below belongs to this field. */}
            <span
              className={cn(
                "text-editor-muted transition-transform [&_svg]:size-3",
                open && "rotate-180",
              )}
              aria-hidden
            >
              <ChevronDownIcon />
            </span>
          </button>

          {/* Short of the rims and centred between them. Run the full height it
              met the well's own rounded corners at a tangent, which reads as the
              control being cut in two rather than divided. */}
          <span className="my-auto h-[60%] w-px flex-none bg-white/10" aria-hidden />

          {/* Left, against the divider: it is the value being read, and a number
              pushed to the far edge of a wide field sits away from the swatch it
              belongs to. */}
          <input
            aria-label={`${label}, as hex`}
            // Overridden shows in the value's weight, the way it does in a
            // slider's label. Not a ring or a border: this well is a swatch, a
            // divider and a reading, and an outline round the lot reads as the
            // field being focused rather than as the clip having its own colour.
            className={cn(
              "min-w-0 flex-1 bg-transparent px-2 font-mono text-[11px] uppercase outline-none",
              overridden && "font-medium",
            )}
            value={draft ?? value}
            // Held as text while being typed: `#1` is not a colour, and
            // committing it would reset the swatch to black mid-keystroke.
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
      </div>

      {open && (
        // Lined up with the well rather than the row, so it reads as belonging
        // to the field rather than as one of its own. `ml-6` is the icon and
        // the gap beside it.
        <div className="mt-2 ml-6">
          <ColorPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

/** A percentage, which is how every fractional setting is shown. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
