import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
} from "react";

import { cn } from "../lib/cn";

/**
 * Which edge of the control the label sits against.
 *
 * Only the two that are needed. The dock is a strip along the bottom of the
 * screen, so its labels go up; the inspector's rail is a column against the
 * right edge of the window, so its labels go left.
 */
export type TooltipSide = "top" | "left";

/**
 * How long the pointer rests on a control before its label appears.
 *
 * Long enough that sweeping across the dock to reach a button does not light
 * up every label on the way; short enough that hovering to ask "what is this"
 * gets an answer before it starts to feel ignored. macOS's own is a touch
 * longer, and reads as sluggish on a strip of six icons.
 */
const DELAY_MS = 400;

/**
 * How long after one label closes the next one opens without the delay.
 *
 * This is what makes a row of icons feel like one control rather than six: the
 * first label waits, and every one after it appears the moment the pointer
 * arrives — and, because the bubble is one element that is still mounted, it
 * slides from the last button to the new one instead of blinking between them.
 */
const WARM_MS = 300;

/** The fade out. The element stays mounted this long so it has time to run. */
const EXIT_MS = 120;

/** Between the control and the label. */
const GAP = 6;

/** The label is kept at least this far inside the window. */
const MARGIN = 6;

/**
 * What a tooltip says.
 *
 * A string for the great majority of them — a control whose name is the whole
 * explanation, which is every icon in the dock and every tab in the rail.
 *
 * The long form is for a control that does something a name cannot carry on
 * its own: a drawing tool is a verb with a gesture attached, and "Mask" says
 * nothing about dragging a rectangle over what you want hidden. It also holds
 * the key that reaches it, because a toolbar of eight modes is exactly where a
 * shortcut is worth learning and exactly where nobody goes looking for a list.
 *
 * One shape rather than a second component beside this one. There is one
 * tooltip per window on purpose — it is what lets the bubble glide from one
 * button to its neighbour rather than blink — and a richer bubble elsewhere
 * would be a second thing that has to be told to close.
 */
export type TooltipLabel =
  | string
  | {
      title: string;
      /** One short line under the title. What the control does, not what it is. */
      detail?: string;
      /** The key that reaches it, already written the way a menu writes one. */
      keys?: string;
    };

interface Anchor {
  label: TooltipLabel;
  side: TooltipSide;
  element: HTMLElement;
}

/** The title alone, which is what a label is compared and read by. */
function titleOf(label: TooltipLabel): string {
  return typeof label === "string" ? label : label.title;
}

function detailOf(label: TooltipLabel): string | undefined {
  return typeof label === "string" ? undefined : label.detail;
}

function keysOf(label: TooltipLabel): string | undefined {
  return typeof label === "string" ? undefined : label.keys;
}

/**
 * One tooltip per window, shared by every control in it.
 *
 * A store rather than state in each control, for two reasons that turn out to
 * be the same one. Only one label can ever be showing, so the "was one showing
 * a moment ago" question that decides whether to wait or not has to be asked
 * somewhere every control can see. And the label sliding from one button to
 * the next is only possible if it is the *same* element being moved — a bubble
 * per control could fade one out and the next in, and nothing more.
 */
let anchor: Anchor | null = null;
let closedAt = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => anchor;

const cancelPending = () => {
  if (pending === null) return;
  clearTimeout(pending);
  pending = null;
};

const show = (next: Anchor) => {
  cancelPending();
  anchor = next;
  notify();
};

const hide = (element: HTMLElement) => {
  cancelPending();
  // Only the control that is showing may close the bubble. Pointer events
  // interleave across neighbours — B's `enter` can land before A's `leave` —
  // and without this check A's leave would close the label B just opened.
  if (anchor?.element !== element) return;
  anchor = null;
  closedAt = performance.now();
  notify();
};

const request = (next: Anchor) => {
  // Warm: something was showing, or was until a moment ago. No wait.
  if (anchor !== null || performance.now() - closedAt < WARM_MS) {
    show(next);
    return;
  }
  cancelPending();
  pending = setTimeout(() => show(next), DELAY_MS);
};

/**
 * Gives a control a label that appears on hover.
 *
 * Returns the props the control has to spread, and nothing to render: the
 * bubble itself is drawn once per window by `TooltipLayer`. The control keeps
 * its `aria-label` — the tooltip is for eyes, and a screen reader is already
 * told the name — but must drop its `title`, or the native one turns up
 * underneath after its own second.
 *
 * Handlers are returned rather than attached, because the controls this is for
 * already have handlers of their own — the rail's buttons move a hover pill on
 * `pointerenter` — and a wrapper element would put a box between a flex row
 * and its items.
 */
export function useTooltip(label: TooltipLabel, side: TooltipSide = "top") {
  const element = useRef<HTMLElement | null>(null);
  // `pointerdown` dismisses the label — a person who has just pressed the
  // button does not need to be told what it was — and this is what keeps the
  // focus that follows the press from bringing it straight back. Cleared on
  // leaving, so the next visit is a fresh one.
  const dismissed = useRef(false);

  // A label that changes while it is showing is re-sent, so a control whose
  // wording depends on its state — "Turn camera on" — never shows stale text.
  // Closing and reopening is what a click already does, so this only matters
  // for a label changed by something other than the pointer.
  useEffect(() => {
    const current = element.current;
    if (!current || anchor?.element !== current) return;

    // Compared by the words rather than by identity: the long form is an
    // object literal, so a control that re-renders hands in a new one every
    // time and an identity check would re-show the bubble on every render —
    // which restarts its entrance animation under a motionless pointer.
    const was = anchor.label;
    const same =
      titleOf(was) === titleOf(label) &&
      detailOf(was) === detailOf(label) &&
      keysOf(was) === keysOf(label);
    if (!same) show({ label, side, element: current });
    // The label is a literal at most call sites; see above for why its
    // identity is not what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleOf(label), detailOf(label), keysOf(label), side]);

  // Detaching is the unmount path: a control that leaves while its label is
  // up — the setup row collapsing into the recording view — takes the label
  // with it, or the bubble is left pointing at nothing.
  //
  // Stable on purpose. React calls a ref callback again whenever its identity
  // changes, with `null` first, so an inline one would run this detach — and
  // close the label — every time the control re-rendered, which the rail does
  // on every hover. A caller merging this with a ref of its own has to keep
  // the merged one stable for the same reason.
  const ref = useCallback((node: HTMLElement | null) => {
    if (node === null && element.current) hide(element.current);
    element.current = node;
  }, []);

  const open = () => {
    if (!element.current) return;
    request({ label, side, element: element.current });
  };

  const close = () => {
    if (element.current) hide(element.current);
  };

  return {
    ref,
    onPointerEnter: () => {
      dismissed.current = false;
      open();
    },
    onPointerLeave: () => {
      dismissed.current = false;
      close();
    },
    onPointerDown: () => {
      dismissed.current = true;
      close();
    },
    // Only for keyboard focus. A click focuses a button too, and showing the
    // label for that would undo the `pointerdown` above.
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (dismissed.current || !event.currentTarget.matches(":focus-visible")) return;
      open();
    },
    onBlur: () => close(),
  };
}

/**
 * The bubble. Mounted once per window, in `Root`.
 *
 * Two elements. The outer one is placed with a `transform` that transitions,
 * so a label moving between neighbouring controls glides rather than jumps.
 * The inner one carries the entrance: it fades and eases in from the control's
 * side when the bubble first appears, and fades out when it closes. Splitting
 * them is what lets a glide and an entrance be different things — one
 * element doing both would ease in from the last control's position, which
 * reads as the label flying across the panel.
 */
export function TooltipLayer() {
  const current = useSyncExternalStore(subscribe, snapshot);

  // What is on screen. Lags `current` on the way out, so the fade has an
  // element to run on; a fresh anchor during the fade takes it over and the
  // bubble slides instead of remounting.
  const [shown, setShown] = useState<Anchor | null>(null);
  const open = current !== null;

  useEffect(() => {
    if (current !== null) {
      setShown(current);
      return;
    }
    const timer = setTimeout(() => setShown(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [current]);

  const bubble = useRef<HTMLDivElement>(null);

  // Measured after the text is in the DOM, because the label's width is what
  // centres it, and written straight to the element: React state here would
  // paint the bubble once at the old position and once at the new one.
  useLayoutEffect(() => {
    const node = bubble.current;
    if (!node || !shown) return;

    const control = shown.element.getBoundingClientRect();
    const { width, height } = node.getBoundingClientRect();
    const maxX = window.innerWidth - width - MARGIN;
    const maxY = window.innerHeight - height - MARGIN;

    const [x, y] =
      shown.side === "top"
        ? [control.left + control.width / 2 - width / 2, control.top - GAP - height]
        : [control.left - GAP - width, control.top + control.height / 2 - height / 2];

    // `Math.max` outermost: a label wider than the window pins to the leading
    // edge rather than being pushed off the other side by the clamp.
    const left = Math.round(Math.max(MARGIN, Math.min(x, maxX)));
    const top = Math.round(Math.max(MARGIN, Math.min(y, maxY)));
    node.style.transform = `translate(${String(left)}px, ${String(top)}px)`;
  }, [shown]);

  if (!shown) return null;

  const detail = detailOf(shown.label);
  const keys = keysOf(shown.label);

  return (
    <div
      ref={bubble}
      role="tooltip"
      // `fixed` to the viewport, which is the frame `getBoundingClientRect`
      // measures in, and placed by `transform` rather than `left`/`top` so the
      // move between controls runs on the compositor.
      //
      // `pointer-events-none`: the bubble sits an inset from the control, and
      // a pointer drifting into it must not count as leaving the button.
      className={cn(
        "pointer-events-none fixed top-0 left-0 z-50",
        // Only the short form stays on one line. A description has to wrap, and
        // `whitespace-nowrap` on the box around it would lay the whole sentence
        // out in a strip the width of the sentence.
        detail === undefined && "whitespace-nowrap",
        "transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
      )}
    >
      <div
        data-open={open}
        // Its own colours rather than `text-dock-fg` and friends. The layer is
        // mounted at the root, outside both `dock-theme` and `editor-theme`,
        // so a scoped token here resolves to nothing — and the bubble is the
        // same dark chip on every surface anyway.
        //
        // The hairline is a translucent white, for the reason `--dock-line`
        // is: the chip floats over a frosted panel and the bare desktop
        // alike, and a fixed dark edge drawn on either reads as a smudge.
        className={cn(
          "rounded-md border border-white/8 bg-[#1c1e22] text-[11px] leading-[14px] text-[#eceef1]",
          // Roomier once there is a sentence in it: a two-line chip at the
          // one-line padding reads as cramped, where the one-liner at this
          // padding reads as a box around a word.
          detail === undefined ? "px-2 py-1" : "w-[15rem] px-2.5 py-2",
          "shadow-[0_2px_8px_rgba(0,0,0,0.35)]",
          "animate-tooltip-in transition-opacity ease-out",
          "data-[open=false]:opacity-0 motion-reduce:animate-none motion-reduce:transition-none",
        )}
        style={
          {
            // Where the entrance comes from: a step towards the control, so
            // the label reads as growing out of it rather than dropping in.
            "--tooltip-shift": shown.side === "top" ? "0, 3px" : "3px, 0",
            transitionDuration: `${String(EXIT_MS)}ms`,
          } as CSSProperties
        }
      >
        {detail === undefined && keys === undefined ? (
          titleOf(shown.label)
        ) : (
          <>
            {/* The name and its key on one row, pushed apart. The key is the
                answer to "is there a faster way", which is a question asked
                about the control rather than about the sentence under it. */}
            <div className="flex items-baseline gap-3">
              <span className="font-medium">{titleOf(shown.label)}</span>
              {keys !== undefined && (
                <span className="ml-auto shrink-0 rounded border border-white/10 bg-white/8 px-1 py-px text-[10px] leading-[13px] text-[#eceef1]/70">
                  {keys}
                </span>
              )}
            </div>

            {detail !== undefined && (
              <p className="mt-1 text-[11px] leading-[15px] text-[#eceef1]/60">{detail}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
