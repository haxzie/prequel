/**
 * What the panel's setup turns into when Record is pressed.
 *
 * Two things here are easy to get wrong and invisible until you watch the
 * output: the camera has to be requested by *label* rather than by the id the
 * panel shows, and every window of ours has to be excluded before capture
 * starts. Both are asserted against the request the recorder actually receives.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  type RecordingPreferences,
  type SelectionResult,
} from "../shared/contract.js";
import {
  findTrack,
  MANIFEST_FILE_NAME,
  MANIFEST_VERSION,
  parseManifest,
} from "../shared/manifest.js";
import { CaptureFlow, matchCamera } from "./capture-flow.js";
import { createFakeRecorder } from "./recorder.fake.js";
import { setRecorder, type StartRecordingRequest } from "./recorder.js";
import { RecordingSession } from "./session.js";

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-flow-"));
process.env["PREQUEL_RECORDINGS_DIR"] = SCRATCH;

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** Ids the fake windows report, so assertions can name them. */
const DOCK_WINDOW_ID = 101;
const CAMERA_WINDOW_ID = 202;

vi.mock("electron", () => ({
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      scaleFactor: 2,
    }),
  },
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
  app: { getPath: () => SCRATCH },
}));

vi.mock("./windows/base.js", () => ({
  windowId: (window: { id: number }) => window.id,
}));

function fakeWindow(id: number) {
  return { id, isDestroyed: () => false } as never;
}

interface DockCalls {
  shown: number;
  hidden: number;
  visible: boolean;
}

function makeFlow(
  preferences: Partial<RecordingPreferences> = {},
  /** What the picker resolves with: a chosen target, or null for cancelled. */
  picked: SelectionResult | null = null,
) {
  const dockCalls: DockCalls = { shown: 0, hidden: 0, visible: false };
  const workspace = { opened: [] as (string | undefined)[] };
  /** How many times the panel opening has asked whether there is a new version. */
  const updateChecks = { count: 0 };
  const welcome = { closed: 0 };
  let stored: RecordingPreferences = { ...DEFAULT_PREFERENCES, ...preferences };
  const selection = {
    opened: 0,
    cancelled: 0,
    isOpen: false,
    browserWindows: () => [],
    open: async () => {
      selection.opened += 1;
      return picked;
    },
    cancel: () => {
      selection.cancelled += 1;
    },
  };
  const camera = {
    shown: false,
    restored: null as { x: number; y: number } | null,
    moved: null as ((p: { x: number; y: number }) => void) | null,
    prepare: () => fakeWindow(CAMERA_WINDOW_ID),
    restore(position: { x: number; y: number } | null) {
      this.restored = position;
    },
    onMove(listener: (p: { x: number; y: number }) => void) {
      this.moved = listener;
    },
    show() {
      this.shown = true;
    },
    hide() {
      this.shown = false;
    },
  };

  const flow = new CaptureFlow({
    session: new RecordingSession(),
    dock: {
      prepare: () => fakeWindow(DOCK_WINDOW_ID),
      setMenuOpen: () => undefined,
      setContentWidth: () => undefined,
      // Tracked rather than fixed: whether the devices should be held open is
      // derived from it, so a stub that never changes cannot show the bug.
      get isVisible() {
        return dockCalls.visible;
      },
      show: () => {
        dockCalls.shown += 1;
        dockCalls.visible = true;
      },
      hide: () => {
        dockCalls.hidden += 1;
        dockCalls.visible = false;
      },
      toggle: () => undefined,
      setView: () => undefined,
    } as never,
    camera: camera as never,
    selection: selection as never,
    preferences: {
      path: join(SCRATCH, "preferences.json"),
      get: () => stored,
      update: (patch: Partial<RecordingPreferences>) => (stored = { ...stored, ...patch }),
    } as never,
    onChange: () => undefined,
    workspace: { open: (dir?: string) => workspace.opened.push(dir) },
    welcome: { close: () => (welcome.closed += 1) },
    checkForUpdates: () => (updateChecks.count += 1),
  });

  return {
    flow,
    camera,
    selection,
    workspace,
    welcome,
    dockCalls,
    updateChecks,
    preferences: () => stored,
  };
}

let requests: StartRecordingRequest[] = [];

beforeEach(() => {
  requests = [];
  const fake = createFakeRecorder();
  setRecorder({
    ...fake,
    startRecording: async (request) => {
      requests.push(request);
      return fake.startRecording(request);
    },
  });
});

afterEach(() => setRecorder(null));

describe("starting a recording", () => {
  it("resolves the panel's camera label to an AVFoundation device id", async () => {
    // Chromium salts `deviceId` per origin, so it is meaningless natively — and
    // its label carries a USB-id suffix the native name does not have.
    const { flow } = makeFlow({
      cameraId: "a-salted-chromium-hash",
      cameraLabel: "FaceTime HD Camera (05ac:8514)",
    });

    await flow.record();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.camera).toBe("fake-camera-0");
  });

  it("records no camera when the camera is switched off", async () => {
    // The label survives in preferences so the next switch-on remembers the
    // device — but a null id means off, and nothing should be recorded.
    const { flow } = makeFlow({ cameraId: null, cameraLabel: "MacBook Pro Camera" });

    await flow.record();

    expect(requests[0]!.camera).toBeUndefined();
  });

  it("excludes the panel and the camera bubble from the capture", async () => {
    // `setContentProtection` does not work against ScreenCaptureKit, so these
    // ids are the only thing keeping our own UI out of the recording.
    const { flow } = makeFlow({ cameraId: "some-id", cameraLabel: "MacBook Pro Camera" });

    await flow.record();

    expect(requests[0]!.excludedWindowIds).toEqual(
      expect.arrayContaining([DOCK_WINDOW_ID, CAMERA_WINDOW_ID]),
    );
  });

  it("prepares the camera window even when the bubble is hidden", async () => {
    // A window created after capture starts cannot be excluded, and the user
    // can switch the camera on mid-recording.
    const { flow } = makeFlow({ cameraId: null, cameraLabel: null });

    await flow.record();

    expect(requests[0]!.excludedWindowIds).toContain(CAMERA_WINDOW_ID);
  });

  it("stamps a wall-clock start for the manifest", async () => {
    const { flow } = makeFlow();

    await flow.record();

    expect(requests[0]!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("stopping a recording", () => {
  it("opens an editor on the recording that just finished", async () => {
    // The take is on disk and nothing else in the app would ever show it.
    const { flow, workspace } = makeFlow();

    await flow.record();
    await flow.stop();

    // The directory the recorder actually wrote to, rather than a path built a
    // second time from the same rule — which would agree even if it drifted.
    expect(workspace.opened).toEqual([requests[0]!.outputPath]);
  });

  it("leaves behind a session the editor can actually open", async () => {
    // The seam between the two halves of this feature: the recorder writes the
    // manifest and the editor parses it. A shape either side does not agree on
    // would only show up as an editor that refuses to open a real recording.
    const { flow, workspace } = makeFlow({
      cameraId: "some-id",
      cameraLabel: "FaceTime HD Camera",
    });

    await flow.record();
    await flow.stop();

    const manifest = parseManifest(
      readFileSync(join(workspace.opened[0]!, MANIFEST_FILE_NAME), "utf8"),
    );

    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.tracks.map((track) => track.kind)).toContain("screen");

    // The screen anchors the clock; the camera opens late and the offset has to
    // survive into the manifest, or nothing can resync the two.
    expect(findTrack(manifest, "screen")!.start).toBe(0);
    expect(findTrack(manifest, "camera")!.start).toBeGreaterThan(0);
  });

  it("opens no editor when there was nothing recording", async () => {
    // A stop that recorded nothing leaves no result, and an editor pointed at a
    // directory with no manifest in it would only fail on open.
    const { flow, workspace } = makeFlow();

    await flow.stop();

    expect(workspace.opened).toEqual([]);
  });

  it("still resets the panel when opening the editor throws", async () => {
    // The recording is already safe on disk; a failure to open an editor for it
    // must not surface as a failed stop.
    const { flow } = makeFlow();
    (flow as unknown as { deps: { workspace: { open: () => void } } }).deps.workspace.open = () => {
      throw new Error("no manifest");
    };

    await flow.record();

    await expect(flow.stop()).resolves.toBeUndefined();
    expect(flow.state().session.status).toBe("idle");
  });
});

describe("editor windows", () => {
  it("gets the recorder's floating UI out of the way", () => {
    // The panel and the bubble exist to set up a recording; the user is now
    // editing one. A picker left up would cover the editor entirely.
    const { flow, camera, selection, dockCalls } = makeFlow({ cameraId: "some-id" });

    flow.workspaceOpened();

    expect(dockCalls.hidden).toBe(1);
    expect(camera.shown).toBe(false);
    expect(selection.cancelled).toBe(1);
  });

  it("brings the panel back without reopening a picker", () => {
    // Closing the editor should return the user to the panel, not drop a
    // full-screen overlay over the screen they were just looking at.
    const { flow, selection, dockCalls } = makeFlow();

    flow.workspaceClosed(true);

    expect(dockCalls.shown).toBe(1);
    expect(selection.opened).toBe(0);
  });
});

describe("the camera bubble", () => {
  it("is put back where the user left it", () => {
    const { camera } = makeFlow({ cameraPosition: { x: 900, y: 400 } });
    expect(camera.restored).toEqual({ x: 900, y: 400 });
  });

  it("remembers a new position when it is dragged", () => {
    const { flow, camera } = makeFlow();
    camera.moved?.({ x: 120, y: 640 });
    expect(flow.state().preferences.cameraPosition).toEqual({ x: 120, y: 640 });
  });

  it("follows the chosen device", () => {
    const { flow, camera } = makeFlow({ cameraId: null });
    expect(camera.shown).toBe(false);

    flow.updatePreferences({ cameraId: "some-id", cameraLabel: "MacBook Pro Camera" });
    expect(camera.shown).toBe(true);

    flow.updatePreferences({ cameraId: null, cameraLabel: null });
    expect(camera.shown).toBe(false);
  });
});

describe("matchCamera", () => {
  const CAMERAS = [
    { id: "native-0", name: "FaceTime HD Camera" },
    { id: "native-1", name: "Logitech StreamCam" },
  ];

  it("strips the USB ids Chromium appends to a label", () => {
    // The bug this exists for: the two strings never compare equal, so a
    // straight lookup finds nothing and the camera is silently not recorded.
    expect(matchCamera("FaceTime HD Camera (05ac:8514)", CAMERAS)?.id).toBe("native-0");
    expect(matchCamera("Logitech StreamCam (046d:0893)", CAMERAS)?.id).toBe("native-1");
  });

  it("matches a label that carries no suffix at all", () => {
    expect(matchCamera("FaceTime HD Camera", CAMERAS)?.id).toBe("native-0");
  });

  it("does not mistake one camera for another", () => {
    expect(matchCamera("Some Other Camera (1234:5678)", CAMERAS)).toBeUndefined();
  });

  it("does not treat a shorter native name as a match for a different device", () => {
    // "Logitech" must not swallow "Logitech StreamCam" the wrong way round:
    // the label extends the native name, never the reverse.
    expect(matchCamera("Logitech", CAMERAS)).toBeUndefined();
  });

  it("finds nothing when there are no cameras", () => {
    expect(matchCamera("FaceTime HD Camera (05ac:8514)", [])).toBeUndefined();
  });
});

describe("choosing a source", () => {
  const TARGET = {
    kind: "Display" as const,
    id: 1,
    title: "Display",
    appName: "",
    appPath: "",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    scaleFactor: 2,
  };

  it("opens the picker for the remembered mode as soon as the panel opens", async () => {
    // Launching the app is only ever a prelude to choosing something.
    const { flow, selection } = makeFlow(
      { mode: "window" },
      {
        target: TARGET,
        crop: null,
        label: "A window",
      },
    );

    flow.open();
    await vi.waitFor(() => expect(selection.opened).toBe(1));

    expect(flow.state().activeMode).toBe("window");
    expect(flow.state().selection?.label).toBe("A window");
  });

  it("clears the active mode when the picker is cancelled", async () => {
    // Escape means nothing was chosen, so nothing should look chosen — the next
    // attempt has to be asked for.
    const { flow } = makeFlow({ mode: "area" }, null);

    await flow.chooseMode("area");

    expect(flow.state().activeMode).toBeNull();
    expect(flow.state().selection).toBeNull();
  });

  it("keeps the mode active once a source is chosen", async () => {
    const { flow } = makeFlow(
      { mode: "screen" },
      {
        target: TARGET,
        crop: null,
        label: "Entire screen",
      },
    );

    await flow.chooseMode("screen");

    expect(flow.state().activeMode).toBe("screen");
    expect(flow.state().selection?.label).toBe("Entire screen");
  });

  it("still remembers the mode for next time after a cancel", async () => {
    // The highlight goes; the preference does not, or reopening the app would
    // have nothing to go straight to.
    const { flow, preferences } = makeFlow({ mode: "screen" }, null);

    await flow.chooseMode("window");

    expect(flow.state().activeMode).toBeNull();
    expect(preferences().mode).toBe("window");
  });

  it("cancels the picker when the panel is dismissed", async () => {
    // An overlay covering the screen with no panel to drive it is a trap.
    const { flow, selection } = makeFlow();

    flow.close();

    expect(selection.cancelled).toBe(1);
  });

  describe("holding the camera and microphone", () => {
    // Hiding a window does not unmount its renderer, so the bubble goes on
    // holding the camera — and the menu-bar light stays on — until something
    // tells it not to. This flag is that something.

    it("lets the devices go when the panel is dismissed", () => {
      const { flow } = makeFlow();

      flow.showDock();
      expect(flow.state().devicesLive).toBe(true);

      flow.close();
      expect(flow.state().devicesLive).toBe(false);
    });

    it("lets them go when an editor takes over", () => {
      const { flow } = makeFlow();
      flow.showDock();

      flow.workspaceOpened();

      expect(flow.state().devicesLive).toBe(false);
    });

    it("takes them back when the editor closes", () => {
      const { flow } = makeFlow();
      flow.workspaceOpened();

      flow.workspaceClosed(true);

      expect(flow.state().devicesLive).toBe(true);
    });
  });
});

describe("the welcome flow", () => {
  it("remembers it was finished, closes the window, and shows the panel", () => {
    const { flow, welcome, dockCalls, preferences } = makeFlow({ welcomed: false });

    flow.finishWelcome();

    expect(preferences().welcomed).toBe(true);
    expect(welcome.closed).toBe(1);
    expect(dockCalls.shown).toBe(1);
  });

  it("records it as finished even when a permission was refused", () => {
    // The flag answers "has this been seen", nothing more. Whether the app can
    // actually record is asked of macOS on every launch, and the window opens
    // again on its own for as long as the answer is no — so writing this only
    // on success would mean two records of the same thing, and one of them
    // eventually wrong.
    const { flow, preferences } = makeFlow({ welcomed: false });

    flow.finishWelcome();

    expect(preferences().welcomed).toBe(true);
  });
});

/**
 * Asking for a new version when the panel opens.
 *
 * The throttle lives in `main/update.ts`; what is asserted here is the other
 * half — *when* the flow asks at all. Both failure modes are invisible: asking
 * on every call makes a request per press of a button that is pressed a lot,
 * and asking on none of them makes an instance that has been running for a
 * fortnight never hear about a release.
 */
describe("the update check behind the panel", () => {
  it("asks when the panel goes up", () => {
    const { flow, updateChecks } = makeFlow();

    flow.showDock();

    expect(updateChecks.count).toBe(1);
  });

  it("does not ask again for a panel that is already up", () => {
    // `showDock` is also how the panel is brought back to the front, and it is
    // called on every return from an editor.
    const { flow, updateChecks } = makeFlow();

    flow.showDock();
    flow.showDock();
    flow.showDock();

    expect(updateChecks.count).toBe(1);
  });

  it("asks again after the panel has been dismissed and reopened", () => {
    const { flow, updateChecks } = makeFlow();

    flow.showDock();
    flow.close();
    flow.showDock();

    expect(updateChecks.count).toBe(2);
  });

  it("stays quiet while a recording is running", async () => {
    // The panel comes back mid-take — a start that failed, an editor closing —
    // and somebody who is recording is the last person with a use for this.
    const { flow, updateChecks } = makeFlow();

    await flow.record();
    updateChecks.count = 0;

    flow.showDock();

    expect(updateChecks.count).toBe(0);
  });
});
