/**
 * Every window Prequel opens is pinned at 100% zoom.
 *
 * Not a preference. Chromium persists a page zoom per origin and every window
 * here loads the same `file://` URL, so one ctrl-scroll over any surface
 * rescales all of them — it is written into the profile, survives the quit, and
 * comes back on the next launch with nothing on screen to say so.
 *
 * On the picker that is a correctness bug rather than a cosmetic one: its
 * overlays draw in CSS pixels that are meant to *be* screen points, so a zoom
 * of 0.91 drew every window highlight, screen outline and found shape nine per
 * cent small, and an area drag cropped a region that was not the one on screen.
 * This pins the fix, because the fix is four lines that look removable.
 */
import { beforeEach, describe as suite, expect, it, vi } from "vitest";

/** One fake `webContents`, recording what was done to it. */
function fakeContents() {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    zoomLevel: null as number | null,
    visualLimits: null as [number, number] | null,
    setZoomLevel(level: number) {
      this.zoomLevel = level;
    },
    setVisualZoomLevelLimits(min: number, max: number) {
      this.visualLimits = [min, max];
      return Promise.resolve();
    },
    on(event: string, handler: () => void) {
      handlers.set(event, handler);
    },
    setWindowOpenHandler: () => undefined,
    /** Fires an event the way Electron would. */
    emit(event: string) {
      handlers.get(event)?.();
    },
  };
}

const windows: ReturnType<typeof fakeWindow>[] = [];

function fakeWindow() {
  return {
    webContents: fakeContents(),
    setVisibleOnAllWorkspaces: () => undefined,
    destroyed: false,
    isDestroyed(): boolean {
      return this.destroyed;
    },
  };
}

vi.mock("electron", () => {
  class FakeBrowserWindow {
    constructor() {
      const window = fakeWindow();
      windows.push(window);
      return window as never;
    }
    /** Every window still open, the way `pinZoom` asks for them. */
    static getAllWindows() {
      return windows;
    }
  }
  return {
    app: { isPackaged: true },
    shell: { openExternal: () => Promise.resolve() },
    BrowserWindow: FakeBrowserWindow,
  };
});

const { createPanel, createWindow, pinZoom } = await import("./base.js");

beforeEach(() => {
  windows.length = 0;
});

suite("pinZoom", () => {
  it("puts every open window back, whatever set them", () => {
    // The gap `lockZoom` leaves: a window that is already open and stays open.
    // The dock is built once and lives for the session, so a gesture on it
    // holds until the app restarts — which is why this runs before a picker
    // and before a take rather than only at construction.
    createPanel();
    createWindow();
    for (const window of windows) window.webContents.setZoomLevel(-0.5);

    pinZoom();

    expect(windows.map((w) => w.webContents.zoomLevel)).toEqual([0, 0]);
  });

  it("steps over a window that has been destroyed", () => {
    createPanel();
    windows[0]!.destroyed = true;

    // A closed overlay is still in the list for a tick after it goes, and
    // touching its `webContents` throws.
    expect(() => pinZoom()).not.toThrow();
  });
});

suite("every window is pinned at 100% zoom", () => {
  for (const [name, make] of [
    ["createPanel", () => createPanel()],
    ["createWindow", () => createWindow()],
  ] as const) {
    it(`${name} starts at zoom 0 and refuses the pinch`, () => {
      make();
      const contents = windows[0]?.webContents;

      expect(contents?.zoomLevel).toBe(0);
      // Both ends at 1, which is what turns the gesture off rather than
      // bounding it — the trackpad is the other way a zoom gets set.
      expect(contents?.visualLimits).toEqual([1, 1]);
    });

    it(`${name} puts the zoom back after a load`, () => {
      make();
      const contents = windows[0]?.webContents;

      // The persisted level is applied per navigation, so pinning it once at
      // construction is not enough — a reload brings the old zoom back with it.
      contents?.setZoomLevel(-0.5);
      contents?.emit("did-finish-load");

      expect(contents?.zoomLevel).toBe(0);
    });

    it(`${name} puts the zoom back when the user changes it`, () => {
      make();
      const contents = windows[0]?.webContents;

      contents?.setZoomLevel(-0.5);
      contents?.emit("zoom-changed");

      expect(contents?.zoomLevel).toBe(0);
    });
  }
});
