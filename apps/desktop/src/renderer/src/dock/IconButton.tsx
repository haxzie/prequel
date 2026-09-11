import { useCallback, type ButtonHTMLAttributes, type Ref } from "react";

import { useTooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * What the glyph means, as a tooltip — and as the accessible name unless the
   * caller gives a better one.
   *
   * Required rather than optional, which is the only thing that keeps it from
   * being forgotten. Nothing about an unlabelled icon looks wrong while it is
   * being written: the author knows what it does, and there is no empty space
   * where the missing name would have shown.
   */
  title: string;
  /** Drawn as the current choice: filled, in the panel's accent. */
  selected?: boolean;
  /** The device this controls is switched off — present, but not in use. */
  off?: boolean;
  /**
   * Passed straight through to the button.
   *
   * React 19 treats `ref` as an ordinary prop, so the spread below carries it —
   * but `ButtonHTMLAttributes` does not declare it, and without this the
   * caller that measures this control to place a menu against it does not
   * typecheck.
   */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The panel's square icon control.
 *
 * Every one of them sits inside a draggable region, so `no-drag` is part of the
 * base rather than something each caller remembers: without it, pressing a
 * button moves the window instead of activating it.
 */
export function IconButton({
  selected,
  off,
  className,
  title,
  "aria-label": label,
  ref,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  ...props
}: IconButtonProps) {
  // Drawn by `TooltipLayer` rather than by the button's `title`. The native
  // one takes a second to appear, cannot be styled, and in a transparent
  // panel window turns up as a grey system chip floating over the desktop.
  const tooltip = useTooltip(title, "top");

  // Both the caller's and the tooltip's. A caller that measures this control
  // to place a menu against it hands in a ref, and the tooltip needs one to
  // measure it too — the second must not replace the first. Memoised because
  // React re-runs a ref callback whose identity changed, detaching first, and
  // the tooltip treats a detach as the control going away.
  const mergedRef = useCallback(
    (node: HTMLButtonElement | null) => {
      tooltip.ref(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref, tooltip.ref],
  );

  return (
    <button
      type="button"
      // The tooltip does double duty. A button holding nothing but an `<svg>`
      // has no text for a screen reader to read, so the label is written as a
      // name as well, and a caller whose tooltip reads badly out of context
      // can still override it.
      aria-label={label ?? title}
      ref={mergedRef}
      onPointerEnter={(event) => {
        tooltip.onPointerEnter();
        onPointerEnter?.(event);
      }}
      onPointerLeave={(event) => {
        tooltip.onPointerLeave();
        onPointerLeave?.(event);
      }}
      onPointerDown={(event) => {
        tooltip.onPointerDown();
        onPointerDown?.(event);
      }}
      onFocus={(event) => {
        tooltip.onFocus(event);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        tooltip.onBlur();
        onBlur?.(event);
      }}
      className={cn(
        "no-drag grid size-[30px] place-items-center rounded-lg disabled:opacity-35 [&_svg]:size-[18px]",
        // Only one of these three is ever emitted. `selected` keeps its fill on
        // hover and brightens instead, and appending a plain hover class here
        // would leave that outcome down to stylesheet order.
        selected
          ? "bg-dock-selected text-white hover:brightness-110"
          : off
            ? "text-dock-muted not-disabled:hover:bg-dock-hover"
            : "text-dock-fg not-disabled:hover:bg-dock-hover",
        className,
      )}
      {...props}
    />
  );
}
