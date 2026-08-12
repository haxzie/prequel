import type { ButtonHTMLAttributes } from "react";

import { cn } from "../lib/cn";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Drawn as the current choice: filled, in the panel's accent. */
  selected?: boolean;
  /** The device this controls is switched off — present, but not in use. */
  off?: boolean;
}

/**
 * The panel's square icon control.
 *
 * Every one of them sits inside a draggable region, so `no-drag` is part of the
 * base rather than something each caller remembers: without it, pressing a
 * button moves the window instead of activating it.
 */
export function IconButton({ selected, off, className, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
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
