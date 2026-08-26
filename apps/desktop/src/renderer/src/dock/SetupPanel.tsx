import { useEffect, useState } from "react";

import type { DockState, ScreenMode } from "../../../shared/contract";
import { missingPermissions } from "../../../shared/permissions";
import { useMediaDevices } from "../hooks/useMediaDevices";
import { usePermissions } from "../hooks/usePermissions";
import {
  AreaIcon,
  CameraIcon,
  CameraOffIcon,
  CloseIcon,
  MicIcon,
  MicOffIcon,
  ScreenIcon,
  WindowIcon,
} from "./icons";
import { DeviceMenu } from "./DeviceMenu";
import { IconButton } from "./IconButton";
import { PermissionMenu } from "./PermissionMenu";

/** Short, centred: a full-height rule would meet the panel's border at both
    ends and read as a seam between two panels rather than a separator inside
    one. */
const DIVIDER = "h-[70%] w-px flex-none self-center bg-dock-line";

const MODES: { mode: ScreenMode; label: string; Icon: typeof ScreenIcon }[] = [
  { mode: "screen", label: "Entire screen", Icon: ScreenIcon },
  { mode: "window", label: "Window", Icon: WindowIcon },
  { mode: "area", label: "Area", Icon: AreaIcon },
];

export function SetupPanel({ state }: { state: DockState }) {
  const { activeMode, selection, preferences, cameraError } = state;
  const cameras = useMediaDevices("videoinput");
  const microphones = useMediaDevices("audioinput");
  const [open, setOpen] = useState<"camera" | "mic" | "permissions" | null>(null);

  // No timer. The panel is up for as long as the app is, and the two
  // permissions that matter here are read from a value macOS fixes at launch —
  // so a poll could never see either turn true and would only wake main every
  // couple of seconds for the life of a menu-bar app. Mount, window focus and
  // the answer a request returns are the three moments this can change.
  const permissions = usePermissions(null);

  // What a recording started *now* would be missing, which is not the same as
  // what is ungranted: a camera nobody has switched on needs no camera grant.
  const missing = missingPermissions(permissions.states, {
    camera: preferences.cameraId !== null,
    microphone: preferences.micId !== null,
  });

  // The window is only as tall as the panel, so main has to grow it before a
  // drop-up can be drawn above it — otherwise the menu is clipped to a sliver
  // of its bottom edge.
  useEffect(() => {
    void window.prequel.dock.setMenuOpen(open !== null);
  }, [open]);

  // The warning can disappear under an open menu — granting the last missing
  // permission from inside it is the ordinary way that happens — and a menu
  // whose button has gone leaves the window grown around nothing.
  useEffect(() => {
    if (open === "permissions" && missing.length === 0) setOpen(null);
  }, [open, missing.length]);

  const chooseMode = (mode: ScreenMode) => void window.prequel.dock.chooseMode(mode);

  return (
    // Sized to its contents — this is the panel's natural width, and what the
    // window is told to match. Dragged by its background; the controls inside
    // opt back out.
    <div
      data-panel="setup"
      className="drag flex h-full w-max animate-view-in items-center gap-1.5 px-1.5"
    >
      <IconButton title="Close" onClick={() => void window.prequel.dock.close()}>
        <CloseIcon />
      </IconButton>

      <span className={DIVIDER} />

      <div className="flex items-center gap-0.5" role="radiogroup" aria-label="What to record">
        {MODES.map(({ mode, label, Icon }) => {
          const active = activeMode === mode;
          return (
            <IconButton
              key={mode}
              role="radio"
              aria-checked={active}
              selected={active}
              // The panel no longer has room for a written summary of what was
              // picked, so the active mode carries it: "Window" on its own does
              // not say which window.
              title={active && selection ? `${label} — ${selection.label}` : label}
              onClick={() => chooseMode(mode)}
            >
              <Icon />
            </IconButton>
          );
        })}
      </div>

      <span className={DIVIDER} />

      <div className="flex items-center gap-0.5">
        <DeviceMenu
          kind="camera"
          devices={cameras}
          selectedId={preferences.cameraId}
          selectedLabel={preferences.cameraLabel}
          error={cameraError}
          open={open === "camera"}
          onToggle={() => setOpen(open === "camera" ? null : "camera")}
          onSelect={(device) => {
            void window.prequel.dock.updatePreferences({
              cameraId: device?.deviceId ?? null,
              cameraLabel: device?.label ?? null,
            });
            setOpen(null);
          }}
          OnIcon={CameraIcon}
          OffIcon={CameraOffIcon}
        />

        <DeviceMenu
          kind="microphone"
          devices={microphones}
          selectedId={preferences.micId}
          selectedLabel={preferences.micLabel}
          meter
          open={open === "mic"}
          onToggle={() => setOpen(open === "mic" ? null : "mic")}
          onSelect={(device) => {
            void window.prequel.dock.updatePreferences({
              micId: device?.deviceId ?? null,
              micLabel: device?.label ?? null,
            });
            setOpen(null);
          }}
          OnIcon={MicIcon}
          OffIcon={MicOffIcon}
        />
      </div>

      {/* Last, and absent entirely when there is nothing wrong. At the end
          rather than beside Close because it must not push the controls people
          reach for before every recording sideways the day it appears. */}
      {missing.length > 0 && (
        <>
          <span className={DIVIDER} />
          <PermissionMenu
            missing={missing}
            permissions={permissions}
            open={open === "permissions"}
            onToggle={() => setOpen(open === "permissions" ? null : "permissions")}
          />
        </>
      )}
    </div>
  );
}
