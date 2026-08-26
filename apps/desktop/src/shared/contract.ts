/**
 * The contract between main, preload and renderer.
 *
 * Deliberately free of any `electron` or Node import so all three bundles can
 * share it — the preload in particular must not pull main-process code in just
 * to learn a channel name.
 */
import type { RecordingResult } from "@prequel/recorder";

import type { CursorSample, Manifest, MediaTime, TrackKind, TypingSample } from "./manifest.js";
import type { CursorTrack, RenderPlan } from "./layout.js";
import type { Project } from "./project.js";
import type { Transcript } from "./transcript.js";

export type { RecordingResult };

/**
 * Structural mirrors of the addon's types.
 *
 * The addon declares these as `const enum`s, which are awkward to consume under
 * `isolatedModules` and force a cast at every literal. Plain string unions are
 * runtime-identical and far easier to work with, so the app speaks these and
 * only the recorder facade touches the generated types.
 */
export type TargetKind = "Display" | "Window";

export type PermissionStatus = "Granted" | "Denied";

/**
 * The four things macOS has to allow before a recording is what it should be.
 *
 * `accessibility` is the one that surprises people, including us: the click tap
 * in `clicks.rs` is handed a *working* tap without it and then receives only
 * events aimed at Prequel itself — so a take comes back with two clicks in it
 * and nothing anywhere says why. Typing detection reads the Accessibility API
 * outright. Both feed the automatic zoom pass, which is why it is asked for
 * here rather than left to be discovered.
 */
export const PERMISSION_IDS = ["screen", "camera", "microphone", "accessibility"] as const;

// A value rather than only a type, because main has to check a
// renderer-supplied string against the set at runtime — `media-protocol.ts`
// serves one icon per id, and a type alone erases before it can guard anything.
export type PermissionId = (typeof PERMISSION_IDS)[number];

export interface PermissionState {
  id: PermissionId;
  granted: boolean;
}

export interface Target {
  kind: TargetKind;
  /** `CGDirectDisplayID` for a display, `CGWindowID` for a window. */
  id: number;
  title: string;
  appName: string;
  /** Path to the owning app's bundle, or empty when unknown. */
  appPath: string;
  bounds: { x: number; y: number; width: number; height: number };
  /** Physical pixels per point. Only meaningful for displays. */
  scaleFactor: number;
}

/** How the user is choosing what to capture. */
export type ScreenMode = "screen" | "window" | "area";

/** What the app does with a take once recording stops. */
export type AfterRecording = "editor" | "finder" | "nothing";

/** Setup the panel remembers between recordings. */
export interface RecordingPreferences {
  mode: ScreenMode;
  /** `deviceId` of the chosen camera, or null when the camera is off. */
  cameraId: string | null;
  /**
   * Label of the chosen camera, stored alongside its id.
   *
   * The label is the durable half of the pair, and it does two jobs. Chromium's
   * `deviceId` is salted and does not survive a restart, so a stored id stops
   * matching and the choice would be silently forgotten; and the id means
   * nothing to AVFoundation, whereas the label *is* `localizedName` on both
   * sides. So the panel restores the choice by label, heals the id back from
   * the current session, and hands the recorder the label.
   */
  cameraLabel: string | null;
  /** `deviceId` of the chosen microphone, or null when the mic is off. */
  micId: string | null;
  /** Label of the chosen microphone. Durable where the id is not — see above. */
  micLabel: string | null;
  systemAudio: boolean;
  /**
   * Draw the system pointer into the recording itself.
   *
   * Off by default, which is not the same as hiding the pointer: it is sampled
   * during capture and composited by the editor instead, which is what makes
   * it possible to hide, resize or zoom to it afterwards. Baking it in is
   * irreversible, so the choice defaults to the one that can be undone.
   *
   * Renamed from `showCursor` rather than repurposed — an existing preferences
   * file has `showCursor: true` in it, and reusing the key would have kept
   * every current user baking the pointer while the editor drew a second one
   * on top.
   */
  bakeCursor: boolean;
  /**
   * Where the user last put the camera bubble, as the *centre* of the circle
   * in screen points.
   *
   * The centre rather than a corner: resizing the bubble grows it from the
   * middle, so a corner would drift every time the size changed. Null until it
   * has been dragged, which is what keeps the default corner placement.
   */
  cameraPosition: { x: number; y: number } | null;
  /**
   * The global start/stop chord, as an Electron accelerator.
   *
   * Stored in the canonical spelling `normaliseAccelerator` produces, so a
   * rebind to the chord already in use compares equal instead of looking like
   * a conflict. Main is the only thing that registers it; every surface that
   * *draws* it reads this and formats it, rather than carrying its own copy.
   */
  toggleShortcut: string;
  /** Seconds counted down before capture starts. Zero begins immediately. */
  countdown: number;
  /**
   * Where recordings are written, or null for `~/Movies/Prequel`.
   *
   * Null rather than the resolved path, so the default follows the home
   * directory instead of being frozen into the file on first launch.
   */
  saveDirectory: string | null;
  /** What happens when a recording stops. */
  afterRecording: AfterRecording;
  /**
   * Whether the welcome flow has been finished.
   *
   * Not recording setup, and the only thing in here that is not — but this file
   * is where the app already keeps what it remembers between launches, and a
   * second store for one boolean would be a second thing to load, sanitise and
   * keep in step. Missing permissions open the welcome window whatever this
   * says; the flag is what stops it opening a second time for someone who has
   * already granted everything.
   */
  welcomed: boolean;
}

export const DEFAULT_PREFERENCES: RecordingPreferences = {
  mode: "screen",
  cameraId: null,
  cameraLabel: null,
  micId: null,
  micLabel: null,
  systemAudio: true,
  bakeCursor: false,
  cameraPosition: null,
  toggleShortcut: "Shift+Cmd+R",
  countdown: 3,
  saveDirectory: null,
  afterRecording: "editor",
  welcomed: false,
};

export interface MediaDevice {
  deviceId: string;
  label: string;
}

/**
 * A device label with Chromium's USB ids stripped — `"FaceTime HD Camera
 * (05ac:8514)"` becomes `"FaceTime HD Camera"`.
 *
 * Chromium builds `MediaDeviceInfo.label` by appending those ids to the name
 * the system uses. They are noise in the panel, and they are the reason a
 * label never compares equal to AVFoundation's `localizedName` — so the same
 * rule has to serve both the display and the lookup.
 */
export function withoutDeviceIds(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
}

/**
 * Transparent margin, in points, between a floating window's edge and the
 * control drawn inside it.
 *
 * macOS shapes a window's own shadow to the window *rectangle*, so a pill or a
 * circle gets a square shadow around it. The shadow is therefore drawn in CSS
 * instead, and this is the room it needs. Main sizes the windows with it and
 * the renderer insets the content by it, so it has to live somewhere both can
 * see.
 */
export const PANEL_INSET = 18;

/** Height of the panel itself, in points. Both views share it. */
export const PANEL_HEIGHT = 44;

/**
 * Extra window height reserved above the panel while a drop-up is open.
 *
 * A drop-up is drawn above the control that opened it, which puts it outside a
 * window that is only as tall as the panel — it gets clipped away to a sliver.
 * The window therefore grows upward for as long as a menu is open, and the
 * panel stays put because it is anchored to the window's bottom edge.
 *
 * Only while open: the added area is transparent, and leaving it there
 * permanently would put a large invisible rectangle over the screen.
 */
export const DOCK_MENU_HEADROOM = 200;

/** What the panel is currently showing. */
export type DockView = "setup" | "recording";

/** A region of a display, in points relative to that display's origin. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The capture the panel is set up to make. */
export interface PendingSelection {
  mode: ScreenMode;
  target: Target;
  /** Set for area mode: the sub-region of the display to capture. */
  crop: Region | null;
  /** Human-readable summary for the panel, e.g. "Safari — Inbox". */
  label: string;
}

export const IPC_CHANNELS = {
  appInfo: "app:info",
  /** Every permission's current state, in one call. */
  permissionStates: "permissions:list",
  /** Asks macOS for one, and answers with every state afterwards. */
  requestPermission: "permissions:request",
  /** Whether macOS starts Prequel at login. */
  loginItem: "app:loginItem",
  /** Adds or removes the login item. */
  setLoginItem: "app:setLoginItem",
  /** Main → renderer: macOS may have changed it while a window sat open. */
  loginItemChanged: "app:loginItemChanged",
  /** Renderer → main: rebind the global start/stop chord. */
  setShortcut: "shortcut:set",
  /** Renderer → main: stop the recording and delete it. */
  sessionDiscard: "session:discard",
  /** Quits and comes back, which is what a new Screen Recording grant needs. */
  relaunchApp: "app:relaunch",
  /** The welcome flow finished. */
  welcomeDone: "welcome:done",
  listSources: "sources:list",
  sessionState: "session:state",
  sessionStart: "session:start",
  sessionStop: "session:stop",
  sessionTogglePause: "session:togglePause",
  revealRecordings: "library:reveal",
  closePopover: "popover:close",
  selectionChoose: "selection:choose",
  selectionCancel: "selection:cancel",
  /**
   * Renderer → main: the countdown has started, so open the camera now.
   *
   * The three seconds the countdown is on screen are the only warm-up an
   * `AVCaptureSession` gets — opened when recording starts instead, it writes a
   * dark second or two before the sensor settles. Main cannot infer this
   * moment: the countdown lives entirely in the selection renderer, and until
   * now it only ever said anything when it finished.
   */
  selectionCountdown: "selection:countdown",
  /** Main → selection renderer, once per overlay. */
  selectionSetup: "selection:setup",
  chooseMode: "dock:chooseMode",
  startRecording: "dock:startRecording",
  preferences: "prefs:get",
  updatePreferences: "prefs:update",
  ensureDeviceAccess: "devices:ensureAccess",
  /** Renderer → main: a drop-up opened or closed, so the window can make room. */
  dockMenu: "dock:menu",
  /** Renderer → main: the panel's natural width, so the window can match it. */
  dockWidth: "dock:width",
  /** Renderer → main: the camera preview failed, or recovered. */
  cameraError: "dock:cameraError",
  /** Main → renderer broadcast. */
  dockChanged: "dock:changed",
  /** Main → renderer broadcast. */
  sessionChanged: "session:changed",
  /** Main → editor renderer, once per window. */
  editorOpen: "editor:open",
  editorSaveProject: "editor:saveProject",
  editorWallpaper: "editor:wallpaper",
  editorPickImage: "editor:pickImage",
  editorPresetImage: "editor:presetImage",
  editorDeleteRecording: "editor:deleteRecording",
  /**
   * Asks where the export should be written, with a save dialog.
   *
   * Separate from `exportStart` rather than folded into it, because the two
   * answer different questions: this one can come back empty — the user changed
   * their mind in the sheet — and that is not a failed export, it is no export.
   * Rolling them together would mean `start` resolving successfully having done
   * nothing, which the dialog cannot tell from a render about to begin.
   */
  exportChoose: "export:choose",
  exportStart: "export:start",
  exportCancel: "export:cancel",
  /** Main → renderer broadcast. */
  exportProgress: "export:progress",
  /** Puts a finished export on the pasteboard as a file. */
  exportCopy: "export:copy",
  /**
   * Renderer → main, one-way: hands a finished export to a native drag.
   *
   * Not `invoke`. `webContents.startDrag` has to be called while the mouse is
   * still down, and a round trip through a promise is long enough that the
   * button is often already up by the time it lands — which reads as a drag
   * that simply does not start.
   */
  exportDrag: "export:drag",
  transcribeStart: "transcribe:start",
  transcribeCancel: "transcribe:cancel",
  /** Main → renderer broadcast. */
  transcribeProgress: "transcribe:progress",
  /** Who is signed in, as much of it as a window is allowed to know. */
  authState: "auth:state",
  /** Opens the browser and waits for the deep link to come back. */
  authSignIn: "auth:signIn",
  authSignOut: "auth:signOut",
  /** Opens the team's library in the default browser. */
  authOpenDashboard: "auth:openDashboard",
  /** Main → renderer broadcast, since several surfaces show the account. */
  authChanged: "auth:changed",
  /** Where the update check has got to. */
  updateState: "update:state",
  /** Renderer → main: look for a newer version now. */
  updateCheck: "update:check",
  /** Renderer → main: start fetching the version already found. */
  updateDownload: "update:download",
  /** Renderer → main: quit and install what has been downloaded. */
  updateInstall: "update:install",
  /** Renderer → main: bring up the update window, which has room to explain. */
  updateOpen: "update:open",
  /** Main → renderer broadcast: the window, the tray and Settings all show it. */
  updateChanged: "update:changed",
  /** Whatever is already known about the licence, with no network call. */
  licenceState: "licence:state",
  /** Asks the server and answers with what it said. Pressed Export triggers it. */
  licenceCheck: "licence:check",
  /** Opens the billing page in the browser. */
  licenceUpgrade: "licence:upgrade",
  /** Main → renderer broadcast, when the verdict changes under a window. */
  licenceChanged: "licence:changed",
  /** Uploads a finished export and answers with a link. */
  shareStart: "share:start",
  shareCancel: "share:cancel",
  /** Main → renderer broadcast. */
  shareProgress: "share:progress",
} as const;

/** One kept span, resolved and ready to render. */
export interface ExportSlice {
  /** Source-time range, in nanoseconds. */
  start: MediaTime;
  end: MediaTime;
  /**
   * The drawing plan for this slice, in absolute output pixels.
   *
   * Built by `shared/layout.ts`, which owns the geometry — the exporter
   * rasterises it rather than working any of it out again. Two implementations
   * of "where does the camera sit" is how a preview and an export come to
   * disagree.
   */
  plan: RenderPlan;
  micVolume: number;
  systemVolume: number;
}

/**
 * What an export is written as.
 *
 * A format rather than a codec, because GIF is not one: it carries no audio and
 * is encoded on the CPU. The extension follows from this, and is worked out in
 * exactly one place — `exportFileName` in `main/export.ts`.
 */
export type ExportFormat = "h264" | "hevc" | "gif";

export interface ExportRequest {
  /** The recording's directory — where the source media is read from. */
  dir: string;
  /**
   * Absolute path of the file to write, as chosen in the save dialog.
   *
   * Comes from `exportChoose`, which is the only thing that ever builds one:
   * the extension has to agree with `format`, and a second place deciding it is
   * how a GIF comes to be written into a file called `.mp4`.
   */
  output: string;
  width: number;
  height: number;
  fps: number;
  format: ExportFormat;
  slices: ExportSlice[];
  /**
   * Per-track offsets from the manifest, in nanoseconds.
   *
   * The only place a late start is recorded: every session file is written
   * zero-based, so the media cannot say when its own track began.
   */
  offsets: Record<TrackKind, MediaTime>;
}

export interface ExportProgress {
  stage: "preparing" | "rendering" | "finalising" | "done" | "failed" | "cancelled";
  framesDone: number;
  framesTotal: number;
  outputPath: string | null;
  error: { code: string | null; message: string } | null;
}

/**
 * How a transcription is going.
 *
 * The same shape as `ExportProgress` in the one way that matters: completion is
 * a terminal stage on this channel rather than a resolved promise, so there is
 * one channel and no race between "finished" arriving twice by two routes.
 *
 * No frame counts. A provider reports nothing until it has finished, so a
 * percentage here would be invented — and an invented bar that sits at 40% for
 * a minute is worse than an honest indeterminate one.
 */
export interface TranscribeProgress {
  /** Which recording this is about; the editor ignores progress for others. */
  dir: string;
  stage: "uploading" | "transcribing" | "done" | "failed" | "cancelled";
  error: { code: string | null; message: string } | null;
  /** Present only on `done`. */
  transcript?: Transcript;
}

/**
 * The signed-in account, as the renderer is allowed to see it.
 *
 * Redacted on purpose. The device token lives in `auth.json` in main and never
 * crosses this boundary — a window has no use for a bearer credential.
 *
 * No avatar URL either. The provider's photo is never drawn: the renderer's CSP
 * is `img-src 'self' data: prequel-media:`, so a remote picture is blocked and
 * renders an empty box, and the account may have no photo at all. Everyone gets
 * a marble generated from their address instead — see `components/Avatar.tsx`.
 */
export interface AuthAccount {
  name: string;
  email: string;
  /** The team a share would go to. Null until onboarding has run. */
  teamName: string | null;
}

/**
 * Whether anybody is signed in.
 *
 * `waiting` is its own state rather than a boolean beside `signed-out`: the
 * browser is open and the app is expecting a deep link, which can take as long
 * as the user takes and can end in nothing at all. A button that says "Sign in"
 * throughout that is a button people press twice.
 */
export type AuthState =
  { status: "signed-out" } | { status: "waiting" } | { status: "signed-in"; account: AuthAccount };

/** What to upload, and what to call it. */
/**
 * Whether this Mac may export.
 *
 * Five states rather than a boolean, because the four that are not "paid" want
 * four different things said to the user. `unknown` is the one that looks like
 * an omission and is not: signed in, never successfully checked — offline on a
 * first run — and the only safe reading of it is to let the export run.
 *
 * Derived in `main/licence.ts` from what `/v1/desktop/entitlement` returns. The
 * trial runs from the account's sign-up date, so it is not restarted by a
 * reinstall.
 */
export type Entitlement =
  | { status: "paid" }
  | { status: "trial"; daysLeft: number }
  | { status: "expired" }
  | { status: "signed-out" }
  | { status: "unknown" };

/** Whether a status is one that may export. */
export function mayExport(entitlement: Entitlement): boolean {
  return (
    entitlement.status === "paid" ||
    entitlement.status === "trial" ||
    entitlement.status === "unknown"
  );
}

export interface ShareRequest {
  /** Absolute path of the finished export. */
  path: string;
  /** A still for the library and the link preview, as a data URL. Optional. */
  poster: string | null;
  title: string;
  durationMs: number;
  width: number;
  height: number;
}

/**
 * How an upload is going.
 *
 * Bytes rather than a percentage, and the same reasoning as `ExportProgress`:
 * completion is a terminal stage on this channel rather than a resolved
 * promise, so there is one path for "finished" and nothing to race.
 */
export interface ShareProgress {
  /** Which export this is about; a dialog ignores progress for any other. */
  path: string;
  stage: "preparing" | "uploading" | "finalising" | "done" | "failed" | "cancelled";
  bytesSent: number;
  bytesTotal: number;
  /** Present only on `done`. */
  url: string | null;
  error: { code: string | null; message: string } | null;
}

/** An image copied into a recording, ready to be used as a background. */
export interface BackgroundImage {
  /** File name relative to the session directory, as `project.json` stores it. */
  path: string;
  /** A `prequel-media://` URL for the same file. */
  url: string;
}

/**
 * The result shape every handler returns for operations that can fail in ways
 * the UI should handle — a denied permission, nothing recording, a window that
 * closed. Rejecting instead would surface as an unhandled promise rejection
 * with no recovery path.
 */
export type IpcResult<T> =
  { ok: true; value: T } | { ok: false; code: string | null; message: string };

export type SessionStatus = "idle" | "starting" | "recording" | "paused" | "stopping";

export interface SessionState {
  status: SessionStatus;
  /** What is being recorded, once a recording is under way. */
  target: Target | null;
  /** Media milliseconds elapsed, excluding paused spans. */
  elapsedMs: number;
  outputPath: string | null;
  error: { code: string | null; message: string } | null;
  lastResult: (RecordingResult & { outputPath: string }) | null;
  /**
   * `CGWindowID`s of our own windows kept out of the recording.
   *
   * Surfaced because a silently-empty list is the failure mode here: the
   * recording still works, it just has Prequel's UI baked into it.
   */
  excludedWindowIds: number[];
}

export interface StartOptions {
  target: Target;
  /** Sub-region of the target to capture, in points. Null captures all of it. */
  crop?: Region | null;
  fps?: number;
  systemAudio?: boolean;
  microphone?: boolean;
  /** Camera to record as its own track, by `localizedName`. */
  camera?: string | null;
  showCursor?: boolean;
  /** `CGWindowID`s of our own windows, so they stay out of the recording. */
  excludedWindowIds?: number[];
}

/** A window as the picker overlay should draw it, in local CSS pixels. */
export interface PickerWindow {
  target: Target;
  rect: { x: number; y: number; width: number; height: number };
  /**
   * The owning app's icon as a data URL, when one could be found.
   *
   * A data URL rather than a path: the overlay runs in a sandboxed renderer
   * with no filesystem access, and an app bundle's icon is not a web-reachable
   * resource anyway.
   */
  icon?: string;
}

/** Everything one picker overlay needs to render its display. */
export interface PickerDisplay {
  displayId: number;
  width: number;
  height: number;
  scaleFactor: number;
  /** The target representing this whole screen. */
  screenTarget: Target;
  windows: PickerWindow[];
}

/** Everything one selection overlay needs to render its display. */
export interface SelectionSetup {
  mode: ScreenMode;
  displayId: number;
  /** Human name for this display, e.g. "Built-in Retina Display". */
  displayLabel: string;
  width: number;
  height: number;
  scaleFactor: number;
  screenTarget: Target;
  windows: PickerWindow[];
}

/** What the user picked in a selection overlay. */
export interface SelectionResult {
  target: Target;
  crop: Region | null;
  label: string;
  /**
   * Start recording immediately rather than returning to the panel.
   *
   * Set by the hovered window's "Start recording" button, which says what it
   * does. Clicking the window itself still only chooses it, so the camera and
   * microphone can be changed before the take begins.
   */
  start?: boolean;
}

/** The panel's full state, pushed from main. */
export interface DockState {
  view: DockView;
  preferences: RecordingPreferences;
  /**
   * The mode currently being chosen or already chosen, or null if none is.
   *
   * Separate from `preferences.mode`, which remembers the last mode used so
   * opening the app can go straight to it. This one drives the highlight, and
   * cancelling a picker clears it — nothing is selected, so nothing should look
   * selected.
   */
  activeMode: ScreenMode | null;
  selection: PendingSelection | null;
  session: SessionState;
  /** Set while an overlay is up, so the panel can dim its own controls. */
  selecting: boolean;
  /**
   * Why the camera preview failed, if it did.
   *
   * A device can be listed and still refuse to open — access revoked, or
   * another app holding it exclusively. Reported by the bubble so the panel can
   * show the camera as errored rather than as merrily on.
   */
  cameraError: string | null;
  /**
   * Whether the renderer should be holding the camera and microphone open.
   *
   * Hiding a window does not unmount its renderer, so a bubble that opened the
   * camera on mount keeps holding it — and the menu-bar recording indicator
   * stays lit — for as long as the app is running. Told rather than inferred:
   * `document.hidden` is not reliable for a hidden panel window, and the answer
   * also depends on things only main knows, like whether an editor has taken
   * over.
   */
  devicesLive: boolean;
}

/**
 * Everything the editor window needs to open a recording.
 *
 * Pushed by main on `did-finish-load` rather than encoded into the route, the
 * same way a selection overlay is set up: a hash route has to survive a reload
 * and an HMR round trip, and a serialised manifest in it would not.
 */
/**
 * The pointers the editor can draw, and where each one actually points.
 *
 * The hotspot is the part that acts, and it differs by shape: an arrow points
 * with its tip, a hand with its fingertip, a circle with its middle. These
 * numbers come from `scripts/make-cursor.mjs`, which prints them when it draws
 * the images — change the artwork there and these follow.
 *
 * A style is a *tone*, not a shape. The two arrows each carry a `hand` of the
 * same tone, drawn wherever the recording says the system was showing the link
 * cursor — so choosing white does not also mean choosing to lose the hand. The
 * circle has none: it is a marker for where the pointer is rather than a
 * pointer, and there is nothing for it to become.
 */
export const CURSOR_STYLES = [
  {
    id: "black",
    label: "Black",
    shapes: {
      arrow: { file: "cursor-black.png", hotspot: { x: 0.055, y: 0.055 } },
      hand: { file: "cursor-black-hand.png", hotspot: { x: 0.3754, y: 0.055 } },
      text: { file: "cursor-black-text.png", hotspot: { x: 0.5, y: 0.5 } },
      "resize-h": { file: "cursor-black-resize-h.png", hotspot: { x: 0.5, y: 0.5 } },
      "resize-v": { file: "cursor-black-resize-v.png", hotspot: { x: 0.5, y: 0.5 } },
    },
  },
  {
    id: "white",
    label: "White",
    shapes: {
      arrow: { file: "cursor-white.png", hotspot: { x: 0.055, y: 0.055 } },
      hand: { file: "cursor-white-hand.png", hotspot: { x: 0.3754, y: 0.055 } },
      text: { file: "cursor-white-text.png", hotspot: { x: 0.5, y: 0.5 } },
      "resize-h": { file: "cursor-white-resize-h.png", hotspot: { x: 0.5, y: 0.5 } },
      "resize-v": { file: "cursor-white-resize-v.png", hotspot: { x: 0.5, y: 0.5 } },
    },
  },
  {
    id: "circle",
    label: "Circle",
    // One image and no others, deliberately. The circle is a marker for where
    // the pointer is rather than a pointer, and there is nothing for it to
    // become — an I-beam version of a dot is just a dot.
    shapes: {
      arrow: { file: "cursor-circle.png", hotspot: { x: 0.5, y: 0.5 } },
    },
  },
] as const;

export type CursorStyleId = (typeof CURSOR_STYLES)[number]["id"];

/** One image, and the point of it that lands on the pointer's position. */
export interface CursorShape {
  path: string;
  hotspot: { x: number; y: number };
}

/**
 * Falls back to the first style rather than throwing, so a project naming one
 * this build no longer ships — every recording made before the pointer became a
 * tone rather than a shape names `light`, `dark`, `hand` or `dot` — opens with
 * the default drawn instead of with no pointer at all.
 */
export function cursorStyle(id: string): (typeof CURSOR_STYLES)[number] {
  return CURSOR_STYLES.find((style) => style.id === id) ?? CURSOR_STYLES[0];
}

/** Every image any style may ask for, which is what has to reach a recording. */
export const CURSOR_FILES: readonly string[] = [
  ...new Set(CURSOR_STYLES.flatMap((style) => Object.values(style.shapes).map((s) => s.file))),
];

/**
 * The image half of a pointer track, for a style id.
 *
 * Here rather than at both call sites: the preview and the export build the
 * same track from the same setting, and a style that resolved differently in
 * one of them is a preview that does not match the file it promised.
 *
 * `arrow` is always present; the rest are whatever the style ships. A kind with
 * no image of its own is drawn as the arrow, which is what every style did for
 * every kind before there were any.
 */
export function cursorImages(id: string): Pick<CursorTrack, "shapes"> {
  const style = cursorStyle(id);

  const shapes = Object.fromEntries(
    Object.entries(style.shapes).map(([kind, shape]) => [
      kind,
      { path: shape.file, hotspot: shape.hotspot },
    ]),
  ) as CursorTrack["shapes"];

  return { shapes };
}

/** The pointer track, ready for the editor to lay out. */
export interface CursorLayer {
  /** Positions of every press, in source time, for the click animation. */
  clicks: MediaTime[];
  /** Positions as fractions of the captured frame, in source time. */
  samples: CursorSample[];
  /**
   * Focused text areas, for a zoom that follows typing.
   *
   * On this layer because a typing zoom needs both tracks: the field when there
   * is one, and the pointer for the stretches where nothing is focused.
   */
  typing: TypingSample[];
}

export interface EditorSession {
  /** Absolute path to the recording's directory. */
  dir: string;
  /** The directory's own name, which is what the title bar shows. */
  name: string;
  manifest: Manifest;
  /** One entry per recorded track, in manifest order. */
  media: TrackMedia[];
  /**
   * The pointer, or null when there is none to draw.
   *
   * Null covers both "the recording has no samples" and "the pointer is
   * already in the picture" — from the editor's side those are the same thing,
   * which is that it has no layer to offer.
   */
  cursor: CursorLayer | null;
  /** The edit, loaded from `project.json` or freshly made. */
  project: Project;
  /**
   * What was said, or null when the recording has not been transcribed.
   *
   * Null also covers a transcript this build cannot read and one that belongs
   * to a different recording — from the editor's side those are the same thing,
   * which is that it has no words to offer and should ask for some.
   */
  transcript: Transcript | null;
}

/** One track, as the renderer plays it. */
export interface TrackMedia {
  kind: TrackKind;
  /**
   * A `prequel-media://` URL.
   *
   * Built by main so the renderer never constructs — or is trusted with — a
   * filesystem path.
   */
  url: string;
  /**
   * Nanoseconds into the session at which this track's first sample lands.
   *
   * The camera routinely opens a few hundred milliseconds after the screen.
   * Taken from the manifest, which is the only place it is recorded: every
   * session file is written zero-based, so the media cannot say when its own
   * track began.
   */
  offset: MediaTime;
  /** Nanoseconds of media in the file. */
  duration: MediaTime;
  width: number | null;
  height: number | null;
  frameRate: number | null;
}

/** One past recording, as the tray's Open Recent menu lists it. */
export interface RecentRecording {
  dir: string;
  name: string;
  /** Epoch milliseconds, newest first. */
  modifiedAt: number;
}

/**
 * How far along an update is.
 *
 * `idle` is also "checked, and there is nothing" — the two are not worth telling
 * apart anywhere they are shown, and a separate state for the second would have
 * every surface handle both identically.
 */
export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export interface UpdateState {
  status: UpdateStatus;
  /** The version running now. */
  current: string;
  /** The version on offer. Set from `available` onwards. */
  version: string | null;
  /**
   * The release body, for the window.
   *
   * Fetched separately from the version itself and allowed to fail on its own —
   * a changelog that did not arrive is a window without a changelog, not a
   * failed check.
   */
  notes: string | null;
  /** 0–100 while downloading. */
  percent: number;
  /** Set only on `error`, and already a sentence to put in front of a user. */
  message: string | null;
}

/**
 * Nothing happening, and no version read yet.
 *
 * `current` is empty rather than a placeholder version: `app.getVersion()`
 * throws before the app is ready, so main fills it in on the way out and a
 * plausible-looking `0.0.0` here would only ever be wrong somewhere.
 */
export const IDLE_UPDATE: UpdateState = {
  status: "idle",
  current: "",
  version: null,
  notes: null,
  percent: 0,
  message: null,
};

export interface AppInfo {
  name: string;
  url: string;
  nodeEnv: string;
  version: string;
  recordingsDir: string;
  preferencesFile: string;
}

export const IDLE_SESSION: SessionState = {
  status: "idle",
  target: null,
  elapsedMs: 0,
  outputPath: null,
  error: null,
  lastResult: null,
  excludedWindowIds: [],
};
