import type { CSSProperties, ReactNode } from "react";

import { useEffect, useRef, useState } from "react";

import { useTooltip } from "../../components/Tooltip";
import { cn } from "../../lib/cn";
import { ChevronDownIcon } from "../icons";
import { ColorPicker } from "./ColorPicker";
import { Detached, useDetached } from "./Detached";

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
/**
 * The shape every control that occupies a row takes.
 *
 * A pill. The window is round now — the panels, the dock, the groups on the
 * title bar — and a rounded rectangle filling in under the pointer beside them
 * reads as a different kind of control rather than as the same one. Stated once
 * because the hover is the thing that gives it away: a track and the highlight
 * drawn over it have to agree, and they drift when each is written separately.
 */
const ROW_SHAPE = "rounded-full";

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

      {/* Pill, like every other control on a row here — see the note on
          `ROW_SHAPE`. The fill inside takes the same radius, or the filled end
          of a track would be square inside a round trough. */}
      <div
        className={cn("group relative flex-1 overflow-hidden", ROW_SHAPE, "bg-white/5", CONTROL_H)}
      >
        {/* The tabs' own pill, not the solid white this was. White was fine while
          the bar was empty; with words on top of it there is nothing legible to
          write in — and the filled part of a slider and the marked tab of a row
          are the same statement, so they should be the same colour. */}
        {/* Rounded like the track it sits in, so the filled end follows the same
          curve as the rim rather than stopping square inside it. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/12 transition-[width] duration-75"
          // A floor, so the fill keeps its rounded end at zero instead of
          // collapsing into a sliver against the left edge.
          style={{ width: `max(0.75rem, ${String(fill)}%)` }}
        >
          {/* Inside the fill, at its leading edge: on a bar this plain it is the
            only part that says it can be dragged. White at rest, where it was
            dark while the fill behind it was solid white. Green on hover — the
            grip is the thing being reached for, so it is the thing that should
            answer.

            A rule and not a dot, which it was for about ten minutes. A disc
            wide enough to read is wide enough to swallow a letter of the label
            it travels across — and the label is white, so whichever of the two
            is on top the other is simply gone. Two pixels of rule cross a word
            without destroying it, which is the whole reason this shape was
            chosen for a control whose label lives inside its track.

            Dimmed at rest. It only has to be found when somebody is reaching
            for it, and at full white it was the brightest thing in a panel of
            muted rows. */}
          <span
            className={cn(
              "absolute top-1/2 right-2 h-3.5 w-0.5 -translate-y-1/2 rounded-full transition-colors",
              disabled ? "bg-white/40" : "bg-white/60 group-hover:bg-toggle",
            )}
          />
        </div>

        {/* Over the fill, so a mark on the filled side is not swallowed by it, and
          under the words, which are what the row is read by. */}
        {levels.map((at) => (
          <span
            key={at}
            aria-hidden
            // Rules, matching the grip. These are the notches a slider snaps
            // to, and a tick in a different shape from the thing that lands on
            // it reads as two unrelated marks.
            className="pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-white/25"
            style={{ left: `${String(at)}%` }}
          />
        ))}

        {/* Over the fill and under the input, so the words never eat a drag.
            `z-10` says so rather than leaving it to paint order: the grip
            travels the length of the row, so at some value it is always behind
            some letter, and which way round that lands should not depend on
            the order two siblings happen to be written in. */}
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-between gap-2 px-2.5 text-[11px]">
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
  /**
   * `disabled` on one option greys that option alone and leaves the rest
   * live: for a choice the recording cannot offer — a cutout with no matte —
   * where greying the whole row would say the *shape* cannot be changed.
   */
  options: {
    value: T;
    label: string;
    title?: string;
    icon?: ReactNode;
    disabled?: boolean;
  }[];
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
    "pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full " +
    "transition-[transform,opacity] ease-out motion-reduce:transition-none";
  const slide = { transitionDuration: `${String(SLIDE_MS)}ms` };

  return (
    <div
      className={cn(
        "relative flex gap-0.5 rounded-full bg-white/5 p-0.5",
        disabled && "opacity-40",
      )}
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
        <SegmentedOption
          key={option.value}
          option={option}
          checked={option.value === value}
          disabled={disabled || option.disabled}
          // A tooltip only where the words are not already on the button: a
          // glyph has to be told, and so does an option with more to say than
          // its label, but a label repeated in a bubble is noise.
          tooltip={option.title ?? (iconsOnly ? option.label : null)}
          // No hover pill on an option that cannot be picked: the pill says
          // "this is where a click would land", and here it would land nowhere.
          onHover={() => setHovered(option.disabled ? null : index)}
          onPick={() => onChange(option.value)}
        >
          {option.icon}
          {!iconsOnly && option.label}
        </SegmentedOption>
      ))}
    </div>
  );
}

/**
 * One option of a `Segmented` row.
 *
 * A component rather than a branch of the `map` above because of the tooltip:
 * `useTooltip` is a hook, and a hook cannot run inside a loop. The app's own
 * bubble rather than `title`, as on the rail and the dock, so a row of glyphs
 * explains itself in the same voice and at the same speed as every other icon
 * in the window.
 */
function SegmentedOption({
  option,
  checked,
  disabled,
  tooltip,
  onHover,
  onPick,
  children,
}: {
  option: { label: string; disabled?: boolean };
  checked: boolean;
  disabled?: boolean;
  /** `null` for no bubble at all. */
  tooltip: string | null;
  onHover: () => void;
  onPick: () => void;
  children: ReactNode;
}) {
  // Always called — the hook has to be — and only spread when there is a
  // label worth showing.
  const bubble = useTooltip(tooltip ?? option.label);
  const labelled = tooltip !== null ? bubble : null;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={option.label}
      disabled={disabled}
      className={cn(
        // The icon sits beside the label rather than replacing it: a glyph
        // alone has to be learned, and a label alone makes every option in
        // the panel look the same at a glance.
        "relative z-10 flex flex-1 items-center justify-center gap-1 rounded-full px-2",
        CONTROL_H,
        "text-[11px] whitespace-nowrap transition-colors [&_svg]:size-3.5",
        checked ? "font-medium text-editor-fg" : "text-editor-muted hover:text-editor-fg",
        option.disabled && "opacity-35 hover:text-editor-muted",
      )}
      {...labelled}
      onPointerEnter={() => {
        labelled?.onPointerEnter();
        onHover();
      }}
      onClick={onPick}
    >
      {children}
    </button>
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

  // One slot is a pill's whole width — see the transform. No inset to subtract
  // any more: the row used to cancel the section's padding and add back `px-4`
  // of its own, and both went when it stopped being a pinned band. The pills
  // run the full width of the row that holds them.
  const slot = { width: `calc(100% / ${String(options.length)})` };
  const pill =
    "pointer-events-none absolute inset-y-1 left-0 rounded-full " +
    "transition-[transform,opacity] ease-out motion-reduce:transition-none";
  const slide = { transitionDuration: `${String(SLIDE_MS)}ms` };

  return (
    // Not sticky, and no band of its own. It was pinned to the top of the
    // panel's scroller so it stayed reachable while a long grid of swatches
    // scrolled past — which worked, and cost an opaque strip across the top of
    // the panel to stop the grid showing through it. The panel that uses this
    // puts the row above its scroller instead: nothing passes underneath, so
    // there is nothing to hide and no surface needed to hide it with.
    //
    // No rule under the row either. The moving pill is what says which tab is
    // which, and a line as well drew a box around a control that is already a
    // band of its own.
    <div className="relative flex py-1" role="tablist" onPointerLeave={() => setHovered(null)}>
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
            "relative z-10 flex flex-1 items-center justify-center rounded-full py-1",
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
        // No fill behind the label. A slider carries one because the fill *is*
        // the reading — it is how far along the track the value sits — and a
        // switch has no such thing to show: the track was a trough with nothing
        // in it, borrowed from a control that needed one. The whole row is still
        // the target, and the hover is what says so.
        className={cn(
          "flex flex-1 items-center justify-between gap-2 rounded-full px-2.5",
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
 * Drawn as the platform's own switch: a capsule track, and a knob that is a
 * wide capsule rather than a disc, the way macOS 26 draws it. It used to be a
 * rounded rectangle at the panel's radius, on the argument that a capsule was
 * the one shape here drawn from a different set — but a switch is the one
 * control everyone already knows from System Settings, and one that matches
 * it reads as a switch before it reads as anything else.
 *
 * The proportions are the system's, scaled to the row: the knob is three
 * fifths of the track's width and sits two pixels inside it. A capsule keeps
 * the two radii concentric for free — each is half its own height, and the
 * knob's height is the track's less the gap either side.
 *
 * The knob moves by `translate` rather than `left`, so the slide runs on the
 * compositor and never lays the row out.
 */
function Switch({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "relative block h-[18px] w-10 flex-none rounded-full transition-colors",
        value ? "bg-toggle" : "bg-white/15",
      )}
      aria-hidden
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-3.5 w-6 rounded-full bg-white",
          "shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform ease-out",
          value && "translate-x-3",
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
  disabled,
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
  /**
   * Shown but not reachable — the same greying every other control here uses.
   *
   * Kept on screen rather than removed, because a control that vanishes takes
   * the answer to "what else could this do?" with it: the row below shifts up,
   * and there is nothing left saying the colour is a thing this edge has.
   */
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { open, toggle, close } = useDetached();
  const row = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col">
      <div ref={row} className={cn("flex items-center gap-2", disabled && "opacity-40")}>
        <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
          {icon}
        </span>

        <div
          className={cn(
            "flex flex-1 items-stretch overflow-hidden rounded-full bg-white/5",
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
            aria-haspopup="dialog"
            disabled={disabled}
            className={cn(
              "flex flex-none items-center gap-1 pr-1.5 pl-2",
              disabled ? "cursor-default" : "cursor-pointer",
            )}
            onClick={toggle}
          >
            {/* Round, like the slider's grip and everything else in a row
                here. A rounded square of colour beside a pill of text was the
                last squared-off thing left in the panels. */}
            <span className="size-4 rounded-full" style={{ backgroundColor: value }} aria-hidden />
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
            disabled={disabled}
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

      {/* Beside the field rather than under it, and never while it is
          disabled: a picker left standing open under a greyed field is a panel
          of live swatches attached to a control that is not taking any.

          It does not close on a change, which every other detached picker here
          does. A colour is chosen by dragging around a gradient — the value
          changes continuously on the way to the one you want — so closing on
          `onChange` would shut the panel on the first pixel of the drag. It
          closes on a press outside it, which for this one is also how you say
          you are finished. */}
      <Detached anchor={row} open={open && !disabled} label="Colour" onClose={close}>
        <ColorPicker value={value} onChange={onChange} />
      </Detached>
    </div>
  );
}

/** A percentage, which is how every fractional setting is shown. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * One choice from a list, opened beside the panel.
 *
 * It opened in the flow for a long time, on the grounds that the inspector is
 * `overflow-hidden` around a scrolling column so a floating menu would be
 * clipped unless it were portalled and then kept in place against scroll and
 * resize. All true, and all it bought was a list that shoved every control
 * below it down the panel while it was open — so choosing a sound moved the
 * volume slider you were about to reach for. `Detached` does the portalling
 * and the keeping in place; see the note there.
 *
 * A dropdown rather than a `Segmented` row for a list that is long, or whose
 * labels are: seven weights in one row were seven abbreviations, and the row
 * changed width with the family. Each row may carry its own `style`, so a
 * list of weights can show each weight in itself, the way the font list
 * shows each face.
 */
export function Dropdown<T extends string>({
  value,
  options,
  disabled,
  action,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; style?: CSSProperties }[];
  disabled?: boolean;
  /**
   * A control at the right-hand end of each open row — the sound pickers' play
   * button, which auditions a keyboard without choosing it.
   *
   * A render prop rather than a field on the option because the control is
   * interactive, and it therefore has to sit *beside* the row's radio rather
   * than inside it: a button within a button is neither valid nor clickable.
   * Returning null leaves a row with none, which is what "Off" wants.
   */
  action?: (option: { value: T; label: string }) => ReactNode;
  onChange: (value: T) => void;
}) {
  const { open, toggle, close } = useDetached();
  const row = useRef<HTMLDivElement>(null);
  const chosen = options.find((option) => option.value === value) ?? options[0];

  return (
    <div ref={row} className={cn("flex flex-col", disabled && "pointer-events-none opacity-40")}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex items-center justify-between gap-2 rounded-full bg-white/5 px-2.5 text-left",
          CONTROL_H,
          open && "bg-white/12",
        )}
        onClick={toggle}
      >
        <span className="truncate text-[13px] text-white" style={chosen?.style}>
          {chosen?.label ?? value}
        </span>
        <span
          className={cn(
            "flex-none text-editor-muted transition-transform [&_svg]:size-3",
            open && "rotate-180",
          )}
          aria-hidden
        >
          <ChevronDownIcon />
        </span>
      </button>

      <Detached anchor={row} open={open && !disabled} label="Choose" onClose={close}>
        <div className="flex flex-col gap-0.5" role="radiogroup">
          {options.map((option) => (
            // The row's surface, rather than the radio itself, so an `action`
            // beside the radio is inside the same highlight. With no action
            // the radio fills the row and this is the shape it always was.
            <div
              key={option.value}
              className={cn(
                "group flex items-center rounded-full transition-colors",
                option.value === value ? "bg-white/12" : "hover:bg-white/6",
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={option.value === value}
                className={cn(
                  "flex min-w-0 flex-1 items-center px-2.5 text-left text-[13px]",
                  CONTROL_H,
                  option.value === value
                    ? "text-editor-fg"
                    : "text-editor-muted group-hover:text-editor-fg",
                )}
                style={option.style}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                {option.label}
              </button>
              {action?.(option)}
            </div>
          ))}
        </div>
      </Detached>
    </div>
  );
}
