import { useRef } from "react";

import { cn } from "../lib/cn";
import { ChevronIcon, PrompterIcon, PrompterOffIcon } from "./icons";

/**
 * The prompter's place on the panel: one control that opens the menu.
 *
 * The same shape as a device control, so the row reads as one family — but not
 * `DeviceMenu` itself, whose props are a device list and a level meter.
 *
 * It was a switch and a chevron with the mode spelled out between them. Off is
 * an item in the menu now, which puts "should this run, and how" in one place
 * instead of splitting it across a button and a list, and takes the mode's
 * word off a strip that had five of them.
 */
export function TeleprompterMenu({
  enabled,
  open,
  onOpen,
}: {
  enabled: boolean;
  open: boolean;
  /** This control's top-left, for main to pop the menu from — as on `DeviceMenu`. */
  onOpen: (anchor: { x: number; y: number }) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openMenu = () => {
    const box = trigger.current?.getBoundingClientRect();
    onOpen(box ? { x: box.left, y: box.top } : { x: 0, y: 0 });
  };

  return (
    <button
      ref={trigger}
      type="button"
      className={cn(
        "no-drag flex h-[30px] items-center gap-1 rounded-lg px-1.5 text-dock-fg",
        "[&_svg]:flex-none",
        open ? "bg-dock-hover" : "hover:bg-dock-hover",
      )}
      aria-label={enabled ? "Teleprompter on" : "Teleprompter off"}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={openMenu}
    >
      <span
        className={cn(
          "grid flex-none place-items-center [&_svg]:size-[18px]",
          enabled ? "text-dock-fg" : "text-dock-muted",
        )}
        aria-hidden="true"
      >
        {enabled ? <PrompterIcon /> : <PrompterOffIcon />}
      </span>
      {/* The same dot the devices carry. No error state: nothing about showing
          the words can fail the way opening a camera can. */}
      <span
        className={cn("size-1.5 flex-none rounded-full", enabled ? "bg-dot-on" : "bg-dot-off")}
        aria-hidden="true"
      />
      <span
        className={cn(
          "flex-none text-dock-muted/60 transition-transform duration-200 [&_svg]:size-[9px]",
          "ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          open && "rotate-180",
        )}
        aria-hidden="true"
      >
        <ChevronIcon />
      </span>
    </button>
  );
}
