import { useEffect, useState } from "react";

import type { DockState, ScreenMode } from "../../../shared/contract";
import { useMediaDevices } from "../hooks/useMediaDevices";
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
  const [open, setOpen] = useState<"camera" | "mic" | null>(null);

  // The window is only as tall as the panel, so main has to grow it before a
  // drop-up can be drawn above it — otherwise the menu is clipped to a sliver
  // of its bottom edge.
  useEffect(() => {
    void window.prequel.dock.setMenuOpen(open !== null);
  }, [open]);

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
    </div>
  );
}
