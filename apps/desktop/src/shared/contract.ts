/**
 * The contract between main, preload and renderer.
 *
 * Deliberately free of any `electron` or Node import so all three bundles can
 * share it — the preload in particular must not pull main-process code in just
 * to learn a channel name.
 */
import type { RecordingResult } from "@prequel/recorder";

import type { CursorSample, Manifest, MediaTime, TrackKind, TypingSample } from "./manifest.js";
import type { RenderPlan } from "./layout.js";
import type { Project } from "./project.js";

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
export type PermissionId = "screen" | "camera" | "microphone" | "accessibility";

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
  /** The recording's directory. The export lands inside it. */
  dir: string;
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
 * with its tip, a hand with its fingertip, a dot with its middle. These numbers
 * come from `scripts/make-cursor.mjs`, which prints them when it draws the
 * images — change the artwork there and these follow.
 */
export const CURSOR_STYLES = [
  { id: "light", label: "Light", file: "cursor-light.png", hotspot: { x: 0.055, y: 0.055 } },
  { id: "dark", label: "Dark", file: "cursor-dark.png", hotspot: { x: 0.055, y: 0.055 } },
  { id: "hand", label: "Hand", file: "cursor-hand.png", hotspot: { x: 0.3754, y: 0.055 } },
  { id: "dot", label: "Dot", file: "cursor-dot.png", hotspot: { x: 0.5, y: 0.5 } },
] as const;

export type CursorStyleId = (typeof CURSOR_STYLES)[number]["id"];

export function cursorStyle(id: string): (typeof CURSOR_STYLES)[number] {
  return CURSOR_STYLES.find((style) => style.id === id) ?? CURSOR_STYLES[0];
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
