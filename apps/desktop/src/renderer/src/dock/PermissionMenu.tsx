import { useRef } from "react";

import type { PermissionId } from "../../../shared/contract";
import { PERMISSION_LABEL } from "../../../shared/permissions";
import { cn } from "../lib/cn";
import { WarningIcon } from "./icons";
import { IconButton } from "./IconButton";

/**
 * The panel's alert, and the only place the app says a permission is missing.
 *
 * Until this existed the recorder knew perfectly well it was blind — it writes
 * a warning to the log at the start of every capture — and said so nowhere the
 * user would ever look. The take came back with one click in it and no
 * explanation.
 *
 * Rendered by `SetupPanel` only when something is actually missing, so it is
 * absent rather than dimmed when all is well: a control that is permanently
 * present and permanently fine is one people stop reading.
 */
export function PermissionMenu({
  missing,
  open,
  onOpen,
}: {
  missing: PermissionId[];
  open: boolean;
  /** As on `DeviceMenu`: this control's top-left, for main to pop the menu
      from. */
  onOpen: (anchor: { x: number; y: number }) => void;
}) {
  // The same anchoring `DeviceMenu` does. This control sits at the right-hand
  // end of the panel; AppKit is what keeps the menu on the screen from there.
  const trigger = useRef<HTMLButtonElement>(null);
  const openMenu = () => {
    const box = trigger.current?.getBoundingClientRect();
    onOpen(box ? { x: box.left, y: box.top } : { x: 0, y: 0 });
  };

  const summary =
    missing.length === 1
      ? `${PERMISSION_LABEL[missing[0]!]} isn't allowed`
      : `${String(missing.length)} permissions aren't allowed`;

  return (
    <div className="flex items-center">
      <IconButton
        ref={trigger}
        title={summary}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={openMenu}
        // Amber rather than the record red, which in this panel means "live".
        // Bright enough to find without becoming the loudest thing in a strip
        // whose actual subject is what you are about to record.
        className={cn("text-dock-warn hover:bg-dock-hover", open && "bg-dock-hover")}
      >
        <WarningIcon />
      </IconButton>
    </div>
  );
}
