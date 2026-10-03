import type {
  CaptureMode,
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
  PhotoIcon,
  ScreenIcon,
  VideoIcon,
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

/**
 * Record, or take a screenshot.
 *
 * Two choices in their own tray at the head of the row, because this is the
 * question asked before any of the others: what the three mode buttons beside
 * it pick, what the confirm button on the picker's card does, and whether the
 * camera, the microphone and the prompter are relevant at all.
 *
 * Icons rather than words. The panel is 44pt tall and the strip is sized to its
 * contents, so "Video" and "Photo" spelled out would cost about seventy points
 * of width that the device names already compete for — and the two glyphs are
 * drawn to read against each other at a glance, which is what the switch has
 * to do.
 */
const CAPTURE_MODES: { mode: CaptureMode; label: string; Icon: typeof ScreenIcon }[] = [
  { mode: "video", label: "Record a video", Icon: VideoIcon },
  { mode: "photo", label: "Take a screenshot", Icon: PhotoIcon },
];

export function SetupPanel({ state }: { state: DockState }) {
  const { activeMode, selection, preferences, cameraError } = state;
  /**
   * Whether this panel is setting up a screenshot.
   *
   * Three controls come off the strip when it is — the camera, the microphone
   * and the prompter — and the permissions warning narrows with them. All four
   * read this rather than the preference, so there is one answer to "is this a
   * screenshot" in this file.
   */
  const photo = preferences.captureMode === "photo";
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
  //
  // A screenshot needs neither device whatever is chosen: it writes one frame
  // of the screen and no camera or microphone track at all, so a camera grant
  // the next *recording* will want must not raise a warning over a shot that
  // will not.
  const missing = missingPermissions(permissions.states, {
    camera: !photo && preferences.cameraId !== null,
    microphone: !photo && preferences.micId !== null,
  });

  const chooseMode = (mode: ScreenMode) => void window.prequel.dock.chooseMode(mode);

  const choose = (kind: "camera" | "microphone", device: MediaDevice | null) => {
    const patch: Partial<RecordingPreferences> =
      kind === "camera"
        ? { cameraId: device?.deviceId ?? null, cameraLabel: device?.label ?? null }
        : { micId: device?.deviceId ?? null, micLabel: device?.label ?? null };

    // Turning the camera on with no microphone chosen picks one, in the same
    // patch: a camera bubble with no narration is the exception, and leaving
    // it off would mean a second trip to this panel just to get sound.
    if (kind === "camera" && device !== null && preferences.micId === null) {
      const mic = microphones[0];
      if (mic) {
        patch.micId = mic.deviceId;
        patch.micLabel = mic.label;
      }
    }

    void window.prequel.dock.updatePreferences(patch);
  };

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
      case "teleprompterDisplay":
        void window.prequel.dock.updatePreferences({ teleprompterDisplay: pick.display });
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
      {/* On their own surface rather than fenced off by a rule either side.
          Three buttons between two dividers read as three things that happen to
          be adjacent; one tray holding them reads as the single choice it is —
          and it drops two of the four rules the strip used to carry.

          The fill alone, with no border on it. An edge as well as a fill states
          the grouping twice on a tray 34px tall, and the one drawn round the
          outside of three buttons that each light up with an edge of their own
          is the one that reads as clutter.

          The same 8px radius as the buttons inside it. Strictly the nesting
          wants the outer corner to be the inner one plus the 2px padding, and
          at that figure the tray reads rounder than the row it sits in; held
          equal, the 2px the button's corner overshoots by is below what the
          edge of a 34px tray shows. */}
      {/* First, in a tray of its own rather than in the one beside it. The
          three buttons there pick *what* is captured and these two pick what
          capturing means — one tray of five would read as five alternatives,
          and the two halves are not alternatives to each other. */}
      <div
        className="flex items-center gap-0.5 rounded-lg bg-dock-group p-0.5"
        role="radiogroup"
        aria-label="Record or screenshot"
      >
        {CAPTURE_MODES.map(({ mode, label, Icon }) => {
          const active = preferences.captureMode === mode;
          return (
            <IconButton
              key={mode}
              role="radio"
              aria-checked={active}
              selected={active}
              title={label}
              onClick={() => void window.prequel.dock.setCaptureMode(mode)}
            >
              <Icon />
            </IconButton>
          );
        })}
      </div>

      <div
        className="flex items-center gap-0.5 rounded-lg bg-dock-group p-0.5"
        role="radiogroup"
        aria-label="What to record"
      >
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

      {/* Absent for a screenshot, rather than disabled. A still has no camera
          track, no microphone track and nothing to read a script to, so three
          dead controls would be the panel offering choices that cannot affect
          the result. The settings behind them are untouched — switching back to
          video finds the camera and the microphone exactly as they were. */}
      {!photo && (
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
      )}

      {/* Towards the end, and absent entirely when there is nothing wrong. Far
          enough along that it cannot push the controls people reach for before
          every recording sideways the day it appears. The update button is here
          for the same reason, and after this one because a missing permission
          is about the recording that is about to be made and an update is
          not. */}
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

      {/* Last on the strip, behind a rule. Everything to the left of it is part
          of setting a recording up and is read left to right; dismissing the
          panel is the one thing here that is not, so it sits at the far end out
          of that sequence rather than at the head of it — and the rule is what
          says so, now that there is no gap in the row to do it.

          Named for where it goes. Dismissing the panel mid-addition returns to
          the editor the addition was started from, not to the library. */}
      <span className={DIVIDER} />
      <IconButton
        title={state.extending ? "Back to the editor" : "Close"}
        onClick={() => void window.prequel.dock.close()}
      >
        <CloseIcon />
      </IconButton>
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
      // Main fills the list in: a renderer cannot see the displays.
      displays: [],
      display: from.preferences.teleprompterDisplay,
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
