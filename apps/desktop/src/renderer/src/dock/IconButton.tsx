import type { ButtonHTMLAttributes, Ref } from "react";

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
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      // The tooltip does double duty. A button holding nothing but an `<svg>`
      // has no text for a screen reader to read, and `title` alone is the
      // weakest way to supply one — so it is written as a name as well, and a
      // caller whose tooltip reads badly out of context can still override it.
      aria-label={label ?? title}
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
