/**
 * The panel's warning is only useful if it is silent when nothing is wrong.
 *
 * Both failures are bad and only one is obvious. A warning that never appears
 * leaves the user where they were before it existed — recording with no clicks
 * captured and no idea why. A warning that appears when nothing is wrong is
 * worse: it is permanent, it is in a panel opened before every recording, and
 * the thing people learn to do with a permanent alert is stop reading it.
 */
import { describe, expect, it } from "vitest";

import type { PermissionState } from "./contract.js";
import { missingPermissions, NEEDS_RESTART } from "./permissions.js";

const NOTHING = { camera: false, microphone: false };
const EVERYTHING = { camera: true, microphone: true };

function states(granted: Partial<Record<string, boolean>>): PermissionState[] {
  return (["screen", "camera", "microphone", "accessibility"] as const).map((id) => ({
    id,
    granted: granted[id] ?? true,
  }));
}

describe("missingPermissions", () => {
  it("says nothing when everything is allowed", () => {
    expect(missingPermissions(states({}), EVERYTHING)).toEqual([]);
  });

  it("says nothing before the first read lands", () => {
    // The empty list is "not asked yet", not "nothing granted". Read the other
    // way it puts a warning on the panel for a moment on every single launch.
    expect(missingPermissions([], EVERYTHING)).toEqual([]);
  });

  it("always counts screen recording", () => {
    expect(missingPermissions(states({ screen: false }), NOTHING)).toEqual(["screen"]);
  });

  it("always counts accessibility, which is the one that fails quietly", () => {
    expect(missingPermissions(states({ accessibility: false }), NOTHING)).toEqual([
      "accessibility",
    ]);
  });

  it("ignores a camera nobody is using", () => {
    // The permanent-alert case. Somebody who never films themselves would
    // otherwise have a warning on the panel for ever.
    expect(missingPermissions(states({ camera: false }), NOTHING)).toEqual([]);
  });

  it("counts the camera once it is switched on", () => {
    expect(missingPermissions(states({ camera: false }), { ...NOTHING, camera: true })).toEqual([
      "camera",
    ]);
  });

  it("ignores a microphone nobody is using, and counts one that is on", () => {
    expect(missingPermissions(states({ microphone: false }), NOTHING)).toEqual([]);
    expect(
      missingPermissions(states({ microphone: false }), { ...NOTHING, microphone: true }),
    ).toEqual(["microphone"]);
  });

  it("reports several in a stable order", () => {
    // Declaration order, not the order the states arrived in — otherwise two
    // polls can reshuffle the list and move a row out from under a pointer.
    const shuffled = [...states({ screen: false, accessibility: false })].reverse();
    expect(missingPermissions(shuffled, EVERYTHING)).toEqual(["screen", "accessibility"]);
  });
});

describe("NEEDS_RESTART", () => {
  it("marks the two macOS decides once per launch", () => {
    // A grant for either of these does not reach the running copy, so the menu
    // has to offer a restart. Getting this wrong means a user pressing Allow,
    // seeing nothing change, and concluding the button does not work.
    expect(NEEDS_RESTART.screen).toBe(true);
    expect(NEEDS_RESTART.accessibility).toBe(true);
    expect(NEEDS_RESTART.camera).toBe(false);
    expect(NEEDS_RESTART.microphone).toBe(false);
  });
});
