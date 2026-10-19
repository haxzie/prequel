/**
 * The overlay can be asked what it should be showing.
 *
 * It used to only be told. Main pushes `selection:setup` the moment
 * `loadRoute` resolves, which is when the *page* has loaded — and every view is
 * a `lazy()` chunk fetched after that, so the overlay's own component was not
 * listening yet and `ipcRenderer` kept nothing for it.
 *
 * Window mode covered it up: its refresh interval sends another list a second
 * later, so the picker filled in and nobody looked further. Screen and area
 * push exactly once, and a lost push left a sheet of dimming with no region to
 * drag and no button to press — which is the bug this pins, in the one shape
 * that reproduces it without a renderer.
 */
import { beforeEach, describe as suite, expect, it, vi } from "vitest";

import type { Target } from "../../shared/contract.js";

const DISPLAYS = [
  { id: 1, label: "Built-in Retina Display", bounds: { x: 0, y: 0, width: 1512, height: 982 } },
  { id: 2, label: "DELL U2723QE", bounds: { x: 1512, y: 0, width: 2560, height: 1440 } },
].map((display) => ({ ...display, scaleFactor: 2 }));

vi.mock("electron", () => ({
  BrowserWindow: class {},
  screen: { getAllDisplays: () => DISPLAYS },
}));

/** Every overlay `createPanel` was asked for, in the order it was asked. */
const panels: FakeWindow[] = [];

/** What `getZoomFactor` answers, so a test can put an overlay at the wrong one. */
let zoomFactor = 1;

interface FakeWindow {
  webContents: {
    on: () => void;
    send: (channel: string, payload: unknown) => void;
    getZoomFactor: () => number;
    setZoomLevel: (level: number) => void;
  };
  /** Every zoom level the overlay was put back to. */
  zoomReset: number[];
  sent: { channel: string; payload: unknown }[];
  isDestroyed: () => boolean;
  setAlwaysOnTop: () => void;
  setFullScreenable: () => void;
  showInactive: () => void;
  focus: () => void;
  destroy: () => void;
}

function fakeWindow(): FakeWindow {
  const window: FakeWindow = {
    sent: [],
    webContents: {
      on: () => undefined,
      send: (channel, payload) => window.sent.push({ channel, payload }),
      // Already pinned by `createPanel`; the overlay checks it anyway, because
      // this is the window where a zoom that is not 1 draws every highlight at
      // the wrong size.
      getZoomFactor: () => zoomFactor,
      setZoomLevel: (level) => window.zoomReset.push(level),
    },
    isDestroyed: () => false,
    zoomReset: [],
    setAlwaysOnTop: () => undefined,
    setFullScreenable: () => undefined,
    showInactive: () => undefined,
    focus: () => undefined,
    destroy: () => undefined,
  };
  return window;
}

vi.mock("./base.js", () => ({
  createPanel: () => {
    const window = fakeWindow();
    panels.push(window);
    return window;
  },
  loadRoute: () => Promise.resolve(),
}));

const { SelectionOverlay } = await import("./selection.js");

function windowTarget(id: number, x: number, title: string): Target {
  return {
    kind: "Window",
    id,
    title,
    appName: "Safari",
    appPath: "/Applications/Safari.app",
    bounds: { x, y: 100, width: 400, height: 300 },
    scaleFactor: 2,
  };
}

let overlay: InstanceType<typeof SelectionOverlay>;

beforeEach(() => {
  panels.length = 0;
  zoomFactor = 1;
  overlay = new SelectionOverlay();
});

suite("an overlay whose zoom is not 1", () => {
  it("is put back before it is shown", async () => {
    // The bug this exists for: Chromium persists a page zoom per origin, every
    // window here is the same origin, and this overlay draws in CSS pixels that
    // are meant to *be* screen points. At 0.913 every highlight it drew — a
    // window's outline, the whole screen, every shape — came out nine per cent
    // small against a screen that had not moved.
    zoomFactor = 1.2 ** -0.5;

    void overlay.open("area", "video", []);
    // `loadRoute` resolves on a microtask in the fake, and the check runs with
    // the push that follows it.
    await Promise.resolve();
    await Promise.resolve();

    expect(panels[0]?.zoomReset).toEqual([0]);
  });

  it("is left alone when it is already 1", async () => {
    void overlay.open("area", "video", []);
    await Promise.resolve();
    await Promise.resolve();

    expect(panels[0]?.zoomReset).toEqual([]);
  });
});

suite("an overlay that asks what to show", () => {
  it("is answered for the display it covers, in area mode", () => {
    // Not awaited: the promise settles when the user picks, which is the thing
    // that never happened in the bug.
    void overlay.open("area", "video", []);

    const setup = overlay.setupFor(panels[0]?.webContents as never);

    expect(setup?.mode).toBe("area");
    expect(setup?.displayId).toBe(1);
    expect(setup?.width).toBe(1512);
    expect(setup?.height).toBe(982);
    // Without this the overlay has nothing to hand back when the drag ends.
    expect(setup?.screenTarget.kind).toBe("Display");
  });

  it("gives each display its own view, in screen mode", () => {
    void overlay.open("screen", "video", []);

    expect(panels).toHaveLength(2);
    expect(overlay.setupFor(panels[0]?.webContents as never)?.displayId).toBe(1);

    const second = overlay.setupFor(panels[1]?.webContents as never);
    expect(second?.displayId).toBe(2);
    expect(second?.displayLabel).toBe("DELL U2723QE");
    // Rebased to the overlay's own window, so the second screen starts at zero
    // rather than at 1512.
    expect(second?.width).toBe(2560);
  });

  it("answers with the newest list rather than the one it opened with", () => {
    void overlay.open("window", "video", [windowTarget(10, 0, "Before")]);

    overlay.update([windowTarget(11, 0, "After")]);

    const setup = overlay.setupFor(panels[0]?.webContents as never);
    expect(setup?.windows.map((entry) => entry.target.title)).toEqual(["After"]);
  });

  it("carries which one it is confirming, through a refresh", () => {
    // The card's copy and its countdown come off this. The window picker
    // re-describes itself every second while it is up, and a refresh that
    // forgot would put "Start recording" back on a screenshot's card.
    void overlay.open("window", "photo", [windowTarget(10, 0, "Before")]);

    expect(overlay.setupFor(panels[0]?.webContents as never)?.capture).toBe("photo");

    overlay.update([windowTarget(11, 0, "After")]);

    expect(overlay.setupFor(panels[0]?.webContents as never)?.capture).toBe("photo");
  });

  it("gives each display only the shapes found on it", () => {
    // The one that would fail quietly. Every overlay draws in its own local
    // coordinates, so a rectangle found on the laptop screen describes
    // somewhere else entirely on the monitor beside it — and an overlay handed
    // the wrong display's shapes would highlight empty space, with nothing in
    // a log to say why.
    void overlay.open("area", "video", []);

    const shapes = [{ x: 10, y: 20, width: 300, height: 200 }];
    overlay.setShapes(2, shapes);

    expect(overlay.setupFor(panels[0]?.webContents as never)?.shapes).toEqual([]);
    expect(overlay.setupFor(panels[1]?.webContents as never)?.shapes).toEqual(shapes);
  });

  it("forgets the shapes it found when a new picker opens", () => {
    // They describe the screen as it looked then. Opening a second picker
    // means the screen has been used since, and drawing the old rectangles
    // over the new arrangement would be worse than drawing none.
    void overlay.open("area", "video", []);
    overlay.setShapes(1, [{ x: 10, y: 20, width: 300, height: 200 }]);

    void overlay.open("area", "video", []);

    expect(overlay.setupFor(panels[2]?.webContents as never)?.shapes).toEqual([]);
  });

  it("does not answer web contents that are not one of its overlays", () => {
    void overlay.open("area", "video", []);

    expect(overlay.setupFor(fakeWindow().webContents as never)).toBeNull();
  });

  it("has nothing to say once the overlays are gone", () => {
    void overlay.open("area", "video", []);
    const contents = panels[0]?.webContents as never;

    overlay.cancel();

    // A reply that described a closed overlay would be worse than none: the
    // renderer would draw a picker for a recording nobody is starting.
    expect(overlay.setupFor(contents)).toBeNull();
  });
});

/**
 * Escape, held for exactly as long as a picker is up.
 *
 * The overlays listen for the key themselves, and that only works while one of
 * them is the key window — which it often is not: the panel above them is
 * clicked to change a camera, a native drop-up takes the keyboard, the script
 * window is open. The key is taken from the whole system instead, and the half
 * that fails silently is giving it back: Escape left bound after the picker has
 * gone is a key taken off every other app with nothing on screen to say why.
 */
suite("the picker's hold on Escape", () => {
  /** What the overlay grabbed, and how often it let go. */
  function held() {
    const keys = { grabs: 0, releases: 0, cancel: null as (() => void) | null };
    const overlay = new SelectionOverlay({
      grabEscape: (cancel) => {
        keys.grabs += 1;
        keys.cancel = cancel;
      },
      releaseEscape: () => (keys.releases += 1),
    });
    return { keys, overlay };
  }

  it("is taken while an overlay is on screen and cancels it", async () => {
    const { keys, overlay } = held();

    const opened = overlay.open("area", "video", []);
    expect(keys.grabs).toBe(1);

    keys.cancel?.();

    await expect(opened).resolves.toBeNull();
    expect(keys.releases).toBeGreaterThan(0);
  });

  it("is given back when the user picks something", async () => {
    const { keys, overlay } = held();

    const opened = overlay.open("screen", "video", []);
    const setup = overlay.setupFor(panels[0]?.webContents as never);
    overlay.choose({ target: setup?.screenTarget as never, label: "Entire screen" });

    await opened;
    expect(keys.releases).toBeGreaterThan(0);
  });
});
