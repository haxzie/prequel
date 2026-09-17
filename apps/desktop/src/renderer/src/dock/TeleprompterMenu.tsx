import { useRef } from "react";

import type { TeleprompterMode } from "../../../shared/contract";
import { cn } from "../lib/cn";
import { ChevronIcon, PrompterIcon, PrompterOffIcon } from "./icons";
import { IconButton } from "./IconButton";

const MODE_LABEL: Record<TeleprompterMode, string> = {
  voice: "Voice",
  timed: "Auto",
  manual: "Manual",
};

/**
 * The prompter's place on the panel: a switch, and a chevron for the rest.
 *
 * The same two-part shape as a device control, so the row reads as one
 * family — but not `DeviceMenu` itself, whose props are a device list and a
 * level meter. What sits beside the chevron is the mode, which is the one
 * choice worth seeing without opening the menu.
 */
export function TeleprompterMenu({
  enabled,
  mode,
  open,
  onToggle,
  onOpen,
}: {
  enabled: boolean;
  mode: TeleprompterMode;
  open: boolean;
  onToggle: (enabled: boolean) => void;
  /** This control's top-left, for main to pop the menu from — as on `DeviceMenu`. */
  onOpen: (anchor: { x: number; y: number }) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openMenu = () => {
    const box = trigger.current?.getBoundingClientRect();
    onOpen(box ? { x: box.left, y: box.top } : { x: 0, y: 0 });
  };

  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        off={!enabled}
        title={enabled ? "Hide the teleprompter" : "Show the teleprompter"}
        aria-pressed={enabled}
        onClick={() => onToggle(!enabled)}
      >
        {enabled ? <PrompterIcon /> : <PrompterOffIcon />}
      </IconButton>

      <button
        ref={trigger}
        type="button"
        className={cn(
          "no-drag flex h-[30px] items-center gap-1.5 rounded-lg px-1.5 text-xs text-dock-fg",
          "[&_svg]:size-[11px] [&_svg]:flex-none [&_svg]:text-dock-muted",
          open ? "bg-dock-hover" : "hover:bg-dock-hover",
        )}
        aria-label={`Teleprompter: ${MODE_LABEL[mode]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={openMenu}
      >
        <span className={cn("truncate text-left", !enabled && "text-dock-muted")}>
          {MODE_LABEL[mode]}
        </span>
        <span
          className={cn(
            "flex-none transition-transform duration-200",
            "ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden="true"
        >
          <ChevronIcon />
        </span>
      </button>
    </div>
  );
}
