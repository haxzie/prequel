import { useLayoutEffect, useRef } from "react";

import { PANEL_INSET, type PermissionId } from "../../../shared/contract";
import { NEEDS_RESTART } from "../../../shared/permissions";
import type { Permissions } from "../hooks/usePermissions";
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
  permissions,
  open,
  onToggle,
}: {
  missing: PermissionId[];
  permissions: Permissions;
  open: boolean;
  onToggle: () => void;
}) {
  // The same nudge `DeviceMenu` does, and for the same reason: this sits at the
  // right-hand end of the panel, so a menu centred on it hangs over the edge.
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!open || !element) return;

    element.style.transform = "translateX(-50%)";
    const { left, right } = element.getBoundingClientRect();

    const past = right - (window.innerWidth - PANEL_INSET);
    const before = PANEL_INSET - left;
    const shift = past > 0 ? -past : before > 0 ? before : 0;

    if (shift !== 0) {
      element.style.transform = `translateX(calc(-50% + ${Math.round(shift)}px))`;
    }
  }, [open, missing.length]);

  // Offered whenever any missing permission is one macOS decides at launch.
  // Pressing Allow on those ends in System Settings, and the grant given there
  // does not reach this copy of Prequel — so without a way back the user does
  // the right thing, returns, and finds the warning still here.
  const restart = missing.some((id) => NEEDS_RESTART[id]);

  const summary =
    missing.length === 1
      ? `${LABEL[missing[0]!]} isn't allowed`
      : `${String(missing.length)} permissions aren't allowed`;

  return (
    <div className="relative flex items-center">
      <IconButton
        title={summary}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
        // Amber rather than the record red, which in this panel means "live".
        // Bright enough to find without becoming the loudest thing in a strip
        // whose actual subject is what you are about to record.
        className={cn("text-dock-warn hover:bg-dock-hover", open && "bg-dock-hover")}
      >
        <WarningIcon />
      </IconButton>

      {open && (
        <div
          ref={menu}
          // Capped to the headroom main grows the window by — see
          // `DOCK_MENU_HEADROOM`. Taller than that and the top of the list is
          // clipped off by the window rather than scrolled.
          className={
            "no-drag absolute bottom-[calc(100%+10px)] left-1/2 z-10 max-h-[180px] w-[320px] " +
            "overflow-y-auto rounded-[10px] border border-dock-line bg-[#2c333d] p-1 " +
            "shadow-[0_6px_20px_rgba(0,0,0,0.45)]"
          }
          role="dialog"
          aria-label="Missing permissions"
        >
          {missing.map((id) => (
            <div key={id} className="flex items-start gap-2 rounded-md p-2">
              <span className="mt-0.5 flex-none text-dock-warn [&_svg]:size-3.5" aria-hidden="true">
                <WarningIcon />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-xs text-dock-fg">{LABEL[id]}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-dock-muted">
                  {CONSEQUENCE[id]}
                </p>
              </div>

              {/* One button per row, which is the call the welcome flow already
                  made. `request` prompts where macOS still will and opens the
                  right System Settings pane where it will not, so a second
                  "Open System Settings" beside it would offer a choice that is
                  not really one. */}
              <button
                type="button"
                className={
                  "no-drag flex-none rounded-md bg-white/10 px-2 py-1 text-[11px] " +
                  "font-medium text-dock-fg hover:bg-white/15"
                }
                onClick={() => void permissions.request(id)}
              >
                Allow
              </button>
            </div>
          ))}

          {restart && (
            <>
              <div className="mx-1.5 my-1 h-px bg-dock-line" />
              <p className="px-2 pb-1 text-[11px] leading-relaxed text-dock-muted">
                Already allowed it in System Settings? macOS only tells Prequel at launch.{" "}
                <button
                  type="button"
                  className="no-drag text-dock-fg underline underline-offset-2 hover:text-white"
                  onClick={() => void window.prequel.welcome.relaunch()}
                >
                  Restart Prequel
                </button>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
