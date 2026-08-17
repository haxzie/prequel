/**
 * Every permission the app needs, asked for the same way.
 *
 * Four permissions, three different APIs and two different outcomes when the
 * user says no — this exists so the welcome flow can treat them as one list
 * rather than carrying a special case per row.
 *
 * The important asymmetry: camera and microphone can be granted from a prompt
 * and take effect at once. Screen Recording and Accessibility cannot. macOS
 * shows their prompt at most once per app, and after that the only way to
 * change the answer is System Settings — which is why every row can fall back
 * to opening the right pane, and why `needsRestart` exists at all.
 */
import { app, shell, systemPreferences } from "electron";

import type { PermissionId, PermissionState } from "../shared/contract.js";
import { log } from "./log.js";
import { getRecorder } from "./recorder.js";

/**
 * The System Settings pane for each one.
 *
 * `x-apple.systempreferences:` with an anchor is the documented way in, and the
 * anchors are stable across the Ventura rename — the URL still opens the right
 * pane of the new Settings app.
 */
const SETTINGS_PANE: Record<PermissionId, string> = {
  screen: "Privacy_ScreenCapture",
  camera: "Privacy_Camera",
  microphone: "Privacy_Microphone",
  accessibility: "Privacy_Accessibility",
};

export async function permissionStates(): Promise<PermissionState[]> {
  return [
    { id: "screen", granted: await screenGranted() },
    { id: "camera", granted: systemPreferences.getMediaAccessStatus("camera") === "granted" },
    {
      id: "microphone",
      granted: systemPreferences.getMediaAccessStatus("microphone") === "granted",
    },
    // `false` asks without prompting. The prompting form is in `request`.
    { id: "accessibility", granted: systemPreferences.isTrustedAccessibilityClient(false) },
  ];
}

/**
 * Asks for one permission, and answers with the state of all of them.
 *
 * All of them because a grant is not always the only thing that changed — and
 * because the caller is drawing a list, so one round trip that refreshes the
 * whole list is both simpler and impossible to leave half-updated.
 */
export async function requestPermission(id: PermissionId): Promise<PermissionState[]> {
  try {
    switch (id) {
      case "screen":
        await requestScreen();
        break;

      case "camera":
      case "microphone":
        await systemPreferences.askForMediaAccess(id);
        break;

      case "accessibility":
        // `true` shows the system's "open System Settings" prompt. It returns
        // the *current* answer, which is always false the first time — the user
        // has not been to Settings yet — so nothing is read from it.
        systemPreferences.isTrustedAccessibilityClient(true);
        break;
    }
  } catch (cause) {
    // Never fatal. A permission that could not be asked for is one the user can
    // still grant in System Settings, and the list says as much.
    console.warn(`[permissions] could not request ${id}:`, cause);
  }

  return permissionStates();
}

/**
 * Opens the System Settings pane for one permission.
 *
 * Main-internal: the welcome window has no button for it, because Allow already
 * ends here for the two macOS will not grant from a prompt.
 */
function openPrivacySettings(id: PermissionId): void {
  void shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${SETTINGS_PANE[id]}`,
  );
}

/**
 * Quits and starts again.
 *
 * The only way a new Screen Recording grant reaches the app. Offered as a
 * button rather than left to the user because a menu-bar app has no obvious
 * quit path — the tray is the only one — so "restart Prequel" is otherwise
 * advice the user cannot easily follow.
 */
export function relaunchApp(): void {
  log("info", "relaunching for a permission change");
  app.relaunch();
  app.quit();
}

async function screenGranted(): Promise<boolean> {
  try {
    return (await getRecorder()).screenAccessStatus() === "Granted";
  } catch (cause) {
    // The addon failing to load is a much bigger problem than this answer, and
    // it is reported where it happens. Here it just means "not granted".
    console.warn("[permissions] could not read screen access:", cause);
    return false;
  }
}

async function requestScreen(): Promise<void> {
  const status = (await getRecorder()).requestScreenAccess();

  // macOS shows its prompt at most once per app. After that this returns
  // `Denied` without showing anything at all, which would look like a button
  // that does nothing — so the second press opens System Settings instead.
  if (status !== "Granted") openPrivacySettings("screen");
}
