/**
 * Which permissions are actually a problem right now.
 *
 * The welcome flow asks for all four and treats them as one list. The panel
 * cannot: two of them are choices rather than faults. A camera that is switched
 * off needs no camera grant, and warning about one would put a permanent alert
 * on a panel belonging to somebody who simply does not film themselves.
 *
 * So the rule is what a recording started *now* would be missing — which is why
 * this takes the panel's device state as well as the permission list.
 *
 * Pure, and imported by the panel rather than reimplemented in it, because the
 * interesting part is the judgement about which ones count and that is worth a
 * test rather than a comment.
 */
import { PERMISSION_IDS, type PermissionId, type PermissionState } from "./contract.js";

/**
 * Whether a grant reaches a copy of Prequel that is already running.
 *
 * Screen Recording and Accessibility are both read from a value macOS fixes at
 * launch — `AXIsProcessTrusted` caches for the life of the process exactly as
 * the screen check does. Granting either while the app is open therefore
 * changes nothing until it restarts, and an interface that does not say so
 * leaves the user pressing Allow, seeing no change, and concluding the button
 * is broken.
 *
 * Camera and microphone come back from a prompt and take effect at once.
 */
export const NEEDS_RESTART: Record<PermissionId, boolean> = {
  screen: true,
  accessibility: true,
  // An event tap made before the grant is never handed a key, and every
  // recording's tap is made by the same process.
  input: true,
  camera: false,
  microphone: false,
};

/** The permission as the panel names it, in a menu that has room for two words. */
export const PERMISSION_LABEL: Record<PermissionId, string> = {
  screen: "Screen Recording",
  accessibility: "Accessibility",
  input: "Input Monitoring",
  camera: "Camera",
  microphone: "Microphone",
};

/**
 * What each missing permission costs, said as a consequence.
 *
 * Not "Prequel needs Accessibility". Nobody grants a permission because an app
 * says it wants one; they grant it when they know what they lose. The
 * Accessibility line is the whole reason the panel's warning exists — without
 * it a recording comes back with one click in it, the automatic zooms have
 * nothing to work from, and every symptom points at the editor rather than at
 * a permission nobody was ever told about.
 *
 * Here rather than beside the menu that shows them, because the menu is built
 * in main and the trigger that summarises them is drawn by the renderer.
 */
export const PERMISSION_CONSEQUENCE: Record<PermissionId, string> = {
  screen: "Nothing can be recorded at all.",
  accessibility: "Clicks aren't captured, so automatic zooms have nothing to find.",
  input:
    "Typing isn't noticed, so there are no typing sounds and the pointer stays over what you type.",
  camera: "Your camera is switched on but won't appear in the recording.",
  microphone: "Your microphone is switched on but won't be heard.",
};

/** What the device menus in the panel currently have switched on. */
export interface DevicesInUse {
  camera: boolean;
  microphone: boolean;
}

/**
 * Whether a missing permission would spoil a recording started now.
 *
 * `screen`, `accessibility` and `input` always count. Screen Recording is the
 * recording; the other two are the ones that fail *quietly*. Without
 * Accessibility the tap in `clicks.rs` receives only events aimed at Prequel
 * itself, so a take comes back with one click in it and the automatic zooms
 * have nothing to work from. Without Input Monitoring the same tap receives
 * every click and no key at all — macOS hands a listen-only tap keyboard
 * events under that grant alone — so typing spans and typing sounds are
 * simply absent, and nothing anywhere says why.
 */
function counts(id: PermissionId, devices: DevicesInUse): boolean {
  switch (id) {
    case "screen":
    case "accessibility":
    case "input":
      return true;
    case "camera":
      return devices.camera;
    case "microphone":
      return devices.microphone;
  }
}

/**
 * The permissions to warn about, in the order they are worth fixing.
 *
 * `PERMISSION_IDS` order rather than the order the states arrive in, so the
 * list cannot reshuffle itself between two polls and move a row out from under
 * a pointer.
 */
export function missingPermissions(
  states: readonly PermissionState[],
  devices: DevicesInUse,
): PermissionId[] {
  return PERMISSION_IDS.filter((id) => {
    if (!counts(id, devices)) return false;

    // Absent, not merely false. The list is empty until the first read lands,
    // and treating that as "nothing is granted" would flash a warning on every
    // launch before the answer arrived.
    const state = states.find((one) => one.id === id);
    return state !== undefined && !state.granted;
  });
}
