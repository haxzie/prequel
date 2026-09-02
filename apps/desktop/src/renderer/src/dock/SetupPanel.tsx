import { useEffect, useRef } from "react";

import type {
  DockMenu,
  DockState,
  MediaDevice,
  PermissionId,
  RecordingPreferences,
  ScreenMode,
} from "../../../shared/contract";
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
import { UpdateButton } from "./UpdateButton";

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
  // Which drop-up is open comes from main, not from here: the menu is its own
  // window and closes itself when a device is picked in it. A local flag would
  // still say "open", and the preference change it had just made would re-send
  // the content and open it straight back up.
  const open = state.openMenu;
  /**
   * Where the open menu is anchored, in this window's coordinates.
   *
   * A ref because it is written by a click and read while rebuilding the
   * payload — holding it in state would re-render the whole panel to record a
   * number that changes nothing on screen.
   */
  const anchor = useRef(0);

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

  /**
   * What the open drop-up should be drawing, pushed to main.
   *
   * Re-sent whenever its contents change and not only when it opens: a device
   * unplugged while the list is up has to leave the list. Keyed on the
   * serialised content rather than on the object, which is rebuilt on every
   * render and would otherwise send an identical payload per keystroke of the
   * audio meter.
   */
  const menu = buildMenu(open, anchor.current, {
    cameras,
    microphones,
    preferences,
    missing,
  });
  const serialised = JSON.stringify(menu);
  const latest = useRef(menu);
  latest.current = menu;
  useEffect(() => {
    void window.prequel.dock.setMenu(latest.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised]);

  // The warning can disappear under an open menu — granting the last missing
  // permission from inside it is the ordinary way that happens — and a menu
  // left open over nothing is a frosted panel floating on the desktop.
  useEffect(() => {
    if (open === "permissions" && missing.length === 0) void window.prequel.dock.setMenu(null);
  }, [open, missing.length]);

  const chooseMode = (mode: ScreenMode) => void window.prequel.dock.chooseMode(mode);

  /**
   * Where the open menu is anchored, in this window's coordinates.
   *
   * A ref because it is written by a click and read while building the payload
   * above — putting it in state would re-render the panel to record a number
   * that changes nothing on screen.
   */
  const toggle = (kind: DockMenu["kind"], anchorX: number) => {
    anchor.current = anchorX;
    void window.prequel.dock.setMenu(
      open === kind
        ? null
        : buildMenu(kind, anchorX, { cameras, microphones, preferences, missing }),
    );
  };

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
          onToggle={(anchorX) => toggle("camera", anchorX)}
          onSelect={(device) =>
            void window.prequel.dock.updatePreferences({
              cameraId: device?.deviceId ?? null,
              cameraLabel: device?.label ?? null,
            })
          }
          OnIcon={CameraIcon}
          OffIcon={CameraOffIcon}
        />

        <DeviceMenu
          kind="microphone"
          devices={microphones}
          selectedId={preferences.micId}
          selectedLabel={preferences.micLabel}
          meter
          open={open === "microphone"}
          onToggle={(anchorX) => toggle("microphone", anchorX)}
          onSelect={(device) =>
            void window.prequel.dock.updatePreferences({
              micId: device?.deviceId ?? null,
              micLabel: device?.label ?? null,
            })
          }
          OnIcon={MicIcon}
          OffIcon={MicOffIcon}
        />
      </div>

      {/* Last, and absent entirely when there is nothing wrong. At the end
          rather than beside Close because it must not push the controls people
          reach for before every recording sideways the day it appears. The
          update button is here for the same reason, and after this one because
          a missing permission is about the recording that is about to be made
          and an update is not. */}
      {missing.length > 0 && (
        <>
          <span className={DIVIDER} />
          <PermissionMenu
            missing={missing}
            open={open === "permissions"}
            onToggle={(anchorX) => toggle("permissions", anchorX)}
          />
        </>
      )}

      <UpdateButton />
    </div>
  );
}

/**
 * The open drop-up's content, as main needs it.
 *
 * Built here rather than in the menu's own window because the device lists are
 * this renderer's: Chromium only fills in device labels for a renderer that has
 * already opened a stream, so a second one enumerating for itself would get a
 * list of blank names and no error at all.
 */
function buildMenu(
  kind: DockMenu["kind"] | null,
  anchorX: number,
  from: {
    cameras: MediaDevice[];
    microphones: MediaDevice[];
    preferences: RecordingPreferences;
    missing: PermissionId[];
  },
): DockMenu | null {
  if (kind === null) return null;
  if (kind === "permissions") return { kind, anchorX, missing: from.missing };

  const camera = kind === "camera";
  return {
    kind,
    anchorX,
    devices: camera ? from.cameras : from.microphones,
    selectedId: camera ? from.preferences.cameraId : from.preferences.micId,
  };
}
