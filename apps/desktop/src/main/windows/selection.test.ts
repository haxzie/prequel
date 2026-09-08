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

interface FakeWindow {
  webContents: { on: () => void; send: (channel: string, payload: unknown) => void };
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
    },
    isDestroyed: () => false,
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
  overlay = new SelectionOverlay();
});

suite("an overlay that asks what to show", () => {
  it("is answered for the display it covers, in area mode", () => {
    // Not awaited: the promise settles when the user picks, which is the thing
    // that never happened in the bug.
    void overlay.open("area", []);

    const setup = overlay.setupFor(panels[0]?.webContents as never);

    expect(setup?.mode).toBe("area");
    expect(setup?.displayId).toBe(1);
    expect(setup?.width).toBe(1512);
    expect(setup?.height).toBe(982);
    // Without this the overlay has nothing to hand back when the drag ends.
    expect(setup?.screenTarget.kind).toBe("Display");
  });

  it("gives each display its own view, in screen mode", () => {
    void overlay.open("screen", []);

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
    void overlay.open("window", [windowTarget(10, 0, "Before")]);

    overlay.update([windowTarget(11, 0, "After")]);

    const setup = overlay.setupFor(panels[0]?.webContents as never);
    expect(setup?.windows.map((entry) => entry.target.title)).toEqual(["After"]);
  });

  it("does not answer web contents that are not one of its overlays", () => {
    void overlay.open("area", []);

    expect(overlay.setupFor(fakeWindow().webContents as never)).toBeNull();
  });

  it("has nothing to say once the overlays are gone", () => {
    void overlay.open("area", []);
    const contents = panels[0]?.webContents as never;

    overlay.cancel();

    // A reply that described a closed overlay would be worse than none: the
    // renderer would draw a picker for a recording nobody is starting.
    expect(overlay.setupFor(contents)).toBeNull();
  });
});
