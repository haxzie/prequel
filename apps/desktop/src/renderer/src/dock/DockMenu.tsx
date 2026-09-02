import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { DockMenu as Menu, MediaDevice, PermissionId } from "../../../shared/contract";
import { DOCK_LIST_MAX_HEIGHT } from "../../../shared/contract";
import { NEEDS_RESTART } from "../../../shared/permissions";
import { usePermissions } from "../hooks/usePermissions";
import { cn } from "../lib/cn";
import { WarningIcon } from "./icons";

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
 * The dock's drop-ups, in their own window.
 *
 * They used to be absolutely positioned children of the panel. The panel is a
 * vibrant window now, and a window carries exactly one frosted material filling
 * exactly its own rectangle — so a menu floating above the pill is a second
 * window or it is not frosted. See `main/windows/dock-menu.ts`.
 *
 * The consequence for this file is that it is told what to draw rather than
 * working it out: the device lists live in the panel's renderer, and Chromium
 * only fills in device *labels* for a renderer that has already opened a
 * stream. Enumerating here would produce a list of blank names and no error.
 */
export function DockMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => window.prequel.dock.onMenu(setMenu), []);

  /**
   * The window is sized to this, so this must never be sized to the window.
   *
   * `w-max` below is what breaks the loop: the body takes its natural width,
   * overflowing a window that is still the wrong size, and main resizes to
   * match. A `w-full` here would report whatever it was last given and the
   * menu would never settle.
   */
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;

    const report = () => {
      const { width, height } = element.getBoundingClientRect();
      void window.prequel.dock.setMenuSize({ width: Math.ceil(width), height: Math.ceil(height) });
    };

    report();
    // Fonts finish loading, a device is unplugged while the list is up — both
    // change the size without this component re-rendering.
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [menu]);

  if (menu === null) return null;

  return (
    <div
      ref={body}
      className={cn(
        // No border, no shadow and no radius: the window is the menu now, so
        // macOS draws all three. A CSS pill inside it would be a second, inset
        // outline around the frosted one.
        "dock-theme bg-dock-menu p-1 text-dock-fg",
        // Prose is set to a measure; a list is set by its longest device name,
        // within bounds. Nothing here caps the *height* — the window is sized
        // to this, and only a device list has a length worth defending against.
        menu.kind === "permissions" ? "w-[320px]" : "w-max min-w-[200px] max-w-[320px]",
      )}
    >
      {menu.kind === "permissions" ? (
        <Permissions missing={menu.missing} />
      ) : (
        <Devices kind={menu.kind} devices={menu.devices} selectedId={menu.selectedId} />
      )}
    </div>
  );
}

/** Closes the menu. Main hides the window and tells the panel it is shut. */
const close = () => void window.prequel.dock.setMenu(null);

function Devices({
  kind,
  devices,
  selectedId,
}: {
  kind: "camera" | "microphone";
  devices: MediaDevice[];
  selectedId: string | null;
}) {
  // The preferences are main's, so this window can write them directly — the
  // panel does not have to be involved in a pick made outside it.
  const choose = (device: MediaDevice | null) => {
    void window.prequel.dock.updatePreferences(
      kind === "camera"
        ? { cameraId: device?.deviceId ?? null, cameraLabel: device?.label ?? null }
        : { micId: device?.deviceId ?? null, micLabel: device?.label ?? null },
    );
    close();
  };

  return (
    <ul
      // The one thing here that can run to any length: a machine can list a
      // dozen microphones, and a menu the height of the screen is not a menu.
      className="m-0 list-none overflow-y-auto"
      style={{ maxHeight: DOCK_LIST_MAX_HEIGHT }}
      role="listbox"
      aria-label={`${kind} devices`}
    >
      {devices.map((device) => (
        <li key={device.deviceId}>
          <MenuItem selected={device.deviceId === selectedId} onClick={() => choose(device)}>
            {device.label}
          </MenuItem>
        </li>
      ))}
      <li className="mx-1.5 my-1 h-px bg-dock-line" />
      <li>
        <MenuItem selected={selectedId === null} onClick={() => choose(null)}>
          Off
        </MenuItem>
      </li>
    </ul>
  );
}

function Permissions({ missing }: { missing: PermissionId[] }) {
  const permissions = usePermissions(null);

  // Offered whenever any missing permission is one macOS decides at launch.
  // Pressing Allow on those ends in System Settings, and the grant given there
  // does not reach this copy of Prequel — so without a way back the user does
  // the right thing, returns, and finds the warning still here.
  const restart = missing.some((id) => NEEDS_RESTART[id]);

  return (
    <div role="dialog" aria-label="Missing permissions">
      {missing.map((id) => (
        <div key={id} className="flex items-start gap-2 rounded-md p-2">
          <span className="mt-0.5 flex-none text-dock-warn [&_svg]:size-3.5" aria-hidden="true">
            <WarningIcon />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-xs text-dock-fg">{LABEL[id]}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-dock-muted">{CONSEQUENCE[id]}</p>
          </div>

          {/* One button per row, which is the call the welcome flow already
              made. `request` prompts where macOS still will and opens the
              right System Settings pane where it will not, so a second
              "Open System Settings" beside it would offer a choice that is
              not really one. */}
          <button
            type="button"
            className={
              "flex-none rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium " +
              "text-dock-fg hover:bg-white/15"
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
              className="text-dock-fg underline underline-offset-2 hover:text-white"
              onClick={() => void window.prequel.welcome.relaunch()}
            >
              Restart Prequel
            </button>
          </p>
        </>
      )}
    </div>
  );
}

function MenuItem({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        "block w-full truncate rounded-[7px] px-[9px] py-1.5 text-left text-xs hover:bg-dock-hover",
        selected ? "font-semibold text-dock-selected" : "text-dock-fg",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
