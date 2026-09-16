/**
 * What main would have said, for a window that has no main.
 *
 * Every value here is a plausible one for a Mac that has used Prequel for a
 * week: signed in, on a trial, every permission granted, a camera and a
 * microphone chosen. Shots that want something else — a missing permission,
 * an expired trial — patch these rather than carrying their own.
 */
import type {
  AppInfo,
  AuthState,
  DockState,
  Entitlement,
  PermissionState,
  RecordingPreferences,
  Target,
  UpdateState,
} from "../src/shared/contract";
import { DEFAULT_PREFERENCES, IDLE_SESSION, IDLE_UPDATE } from "../src/shared/contract";

/** The built-in display of a 14" MacBook Pro, which is what most takes are of. */
export const DISPLAY: Target = {
  kind: "Display",
  id: 1,
  title: "Built-in Retina Display",
  appName: "",
  appPath: "",
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  scaleFactor: 2,
};

export const SAFARI: Target = {
  kind: "Window",
  id: 4021,
  title: "Inbox",
  appName: "Safari",
  appPath: "/Applications/Safari.app",
  bounds: { x: 120, y: 80, width: 1280, height: 820 },
  scaleFactor: 2,
};

export const PREFERENCES: RecordingPreferences = {
  ...DEFAULT_PREFERENCES,
  cameraId: "camera-1",
  cameraLabel: "FaceTime HD Camera",
  micId: "mic-1",
  micLabel: "MacBook Pro Microphone",
  welcomed: true,
};

export const DOCK: DockState = {
  view: "setup",
  preferences: PREFERENCES,
  selection: { mode: "screen", target: DISPLAY, crop: null, label: DISPLAY.title },
  session: IDLE_SESSION,
  activeMode: "screen",
  selecting: false,
  openMenu: null,
  cameraError: null,
  // Off, so the panel draws the device names from `preferences` and never asks
  // the browser for a camera. Headless Chrome has fake devices, but a real
  // Chrome has real ones and would light the camera to take a screenshot.
  devicesLive: false,
};

export function permissions(granted: Partial<Record<PermissionState["id"], boolean>> = {}): PermissionState[] {
  return (["screen", "camera", "microphone", "accessibility"] as const).map((id) => ({
    id,
    granted: granted[id] ?? true,
  }));
}

export const AUTH: AuthState = {
  status: "signed-in",
  account: { name: "Musthaq Ahamad", email: "musthaq@prequel.sh", teamName: "Prequel" },
};

export const TRIAL: Entitlement = { status: "trial", daysLeft: 5 };

export const UPDATE: UpdateState = { ...IDLE_UPDATE, current: "0.0.21" };

export const APP_INFO: AppInfo = {
  name: "Prequel",
  url: "https://prequel.sh",
  nodeEnv: "production",
  version: "0.0.21",
  recordingsDir: "/Users/you/Movies/Prequel",
  preferencesFile: "/Users/you/Library/Application Support/Prequel/preferences.json",
};
