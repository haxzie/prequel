import { useRef } from "react";

import type { PermissionId } from "../../../shared/contract";
import { cn } from "../lib/cn";
import { WarningIcon } from "./icons";
import { IconButton } from "./IconButton";

/**
 * What each missing permission costs, said as a consequence.
 *
 * Not "Prequel needs Accessibility". Nobody grants a permission because an app
 * says it wants one; they grant it when they know what they lose. The
 * Accessibility line is the whole reason this menu exists — without it a
 * recording comes back with one click in it, the automatic zooms have nothing
 * to work from, and every symptom points at the editor rather than at a
 * permission nobody was ever told about.
 */
const CONSEQUENCE: Record<PermissionId, string> = {
  screen: "Nothing can be recorded at all.",
  accessibility: "Clicks and typing aren't captured, so automatic zooms have nothing to find.",
  camera: "Your camera is switched on but won't appear in the recording.",
  microphone: "Your microphone is switched on but won't be heard.",
};

const LABEL: Record<PermissionId, string> = {
  screen: "Screen Recording",
  accessibility: "Accessibility",
  camera: "Camera",
  microphone: "Microphone",
};

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
  onToggle,
}: {
  missing: PermissionId[];
  open: boolean;
  /** As on `DeviceMenu`: the centre of this control, for main to place the
      menu window against. */
  onToggle: (anchorX: number) => void;
}) {
  // The same anchoring `DeviceMenu` does. This control sits at the right-hand
  // end of the panel, which is exactly the case the clamp in
  // `DockMenuWindow.applyBounds` exists for.
  const trigger = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    const box = trigger.current?.getBoundingClientRect();
    onToggle(box ? box.left + box.width / 2 : 0);
  };

  const summary =
    missing.length === 1
      ? `${LABEL[missing[0]!]} isn't allowed`
      : `${String(missing.length)} permissions aren't allowed`;

  return (
    <div className="flex items-center">
      <IconButton
        ref={trigger}
        title={summary}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
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
