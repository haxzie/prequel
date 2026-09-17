import type {
  DockMenu,
  DockMenuPick,
  DockState,
  MediaDevice,
  PermissionId,
  RecordingPreferences,
  ScreenMode,
} from "../../../shared/contract";
import { missingPermissions } from "../../../shared/permissions";
import { useMediaDevices } from "../hooks/useMediaDevices";
import { usePermissions } from "../hooks/usePermissions";
import { useTeleprompter } from "../hooks/useTeleprompter";
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
import { TeleprompterMenu } from "./TeleprompterMenu";
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
  // Which drop-up is open comes from main, not from here: the menu is native
  // and closes itself — on a pick, or on a click anywhere else — and only main
  // hears it close. A local flag would still say "open" after the menu had
  // gone, and the trigger would stay drawn as pressed.
  const open = state.openMenu;

  // No timer. The panel is up for as long as the app is, and the two
  // permissions that matter here are read from a value macOS fixes at launch —
  // so a poll could never see either turn true and would only wake main every
  // couple of seconds for the life of a menu-bar app. Mount, window focus and
  // the answer a request returns are the three moments this can change.
  const permissions = usePermissions(null);
  const hasScript = useTeleprompter().script.trim() !== "";

  // What a recording started *now* would be missing, which is not the same as
  // what is ungranted: a camera nobody has switched on needs no camera grant.
  const missing = missingPermissions(permissions.states, {
    camera: preferences.cameraId !== null,
    microphone: preferences.micId !== null,
  });

  const chooseMode = (mode: ScreenMode) => void window.prequel.dock.chooseMode(mode);

  const choose = (kind: "camera" | "microphone", device: MediaDevice | null) =>
    void window.prequel.dock.updatePreferences(
      kind === "camera"
        ? { cameraId: device?.deviceId ?? null, cameraLabel: device?.label ?? null }
        : { micId: device?.deviceId ?? null, micLabel: device?.label ?? null },
    );

  const act = (pick: DockMenuPick) => {
    switch (pick.kind) {
      case "camera":
      case "microphone":
        choose(pick.kind, pick.device);
        return;
      case "permission":
        void permissions.request(pick.id);
        return;
      case "relaunch":
        void window.prequel.welcome.relaunch();
        return;
      case "teleprompterEdit":
        void window.prequel.teleprompter.openScript();
        return;
      case "teleprompterMode":
        void window.prequel.dock.updatePreferences({ teleprompterMode: pick.mode });
        return;
      case "teleprompterSize":
        void window.prequel.dock.updatePreferences({ teleprompterSize: pick.size });
        return;
    }
  };

  /**
   * Switching the prompter on with nothing to show opens the script window
   * as well, so the first press does not put an empty island on screen and
   * leave the user to find where the words go.
   */
  const togglePrompter = (enabled: boolean) => {
    void window.prequel.dock.updatePreferences({ teleprompter: enabled });
    if (enabled && !hasScript) void window.prequel.teleprompter.openScript();
  };

  /**
   * Opens a drop-up and acts on what comes back from it.
   *
   * The outcome is handled here rather than in main because both halves of it
   * are this renderer's already: a device choice is the same preference write
   * the toggle beside the chevron makes, and a permission request has to go
   * through `permissions` so the warning refreshes from the answer — main
   * asking macOS itself would grant the permission and leave the alert up.
   */
  const openMenu = async (kind: DockMenu["kind"], anchor: { x: number; y: number }) => {
    const pick = await window.prequel.dock.openMenu(
      buildMenu(kind, anchor, { cameras, microphones, preferences, missing }),
    );
    if (pick !== null) act(pick);
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
          onOpen={(anchor) => void openMenu("camera", anchor)}
          onSelect={(device) => choose("camera", device)}
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
          onOpen={(anchor) => void openMenu("microphone", anchor)}
          onSelect={(device) => choose("microphone", device)}
          OnIcon={MicIcon}
          OffIcon={MicOffIcon}
        />

        {/* Only with a microphone: the prompter follows a voice, and a panel
            with no microphone chosen is not about to record one. Auto-scroll
            and manual would work without, but the control's whole reason to
            sit beside the microphone is that it belongs to it. */}
        {preferences.micId !== null && (
          <TeleprompterMenu
            enabled={preferences.teleprompter}
            mode={preferences.teleprompterMode}
            open={open === "teleprompter"}
            onToggle={togglePrompter}
            onOpen={(anchor) => void openMenu("teleprompter", anchor)}
          />
        )}
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
            onOpen={(anchor) => void openMenu("permissions", anchor)}
          />
        </>
      )}

      <UpdateButton />
    </div>
  );
}

/**
 * A drop-up's content, as main needs it to build the menu.
 *
 * Built here rather than in main because the device lists are this renderer's:
 * Chromium only fills in device labels for a renderer that has already opened
 * a stream, and main has no list of its own.
 */
function buildMenu(
  kind: DockMenu["kind"],
  anchor: { x: number; y: number },
  from: {
    cameras: MediaDevice[];
    microphones: MediaDevice[];
    preferences: RecordingPreferences;
    missing: PermissionId[];
  },
): DockMenu {
  if (kind === "permissions") return { kind, anchor, missing: from.missing };
  if (kind === "teleprompter") {
    return {
      kind,
      anchor,
      mode: from.preferences.teleprompterMode,
      size: from.preferences.teleprompterSize,
    };
  }

  const camera = kind === "camera";
  return {
    kind,
    anchor,
    devices: camera ? from.cameras : from.microphones,
    selectedId: camera ? from.preferences.cameraId : from.preferences.micId,
  };
}
