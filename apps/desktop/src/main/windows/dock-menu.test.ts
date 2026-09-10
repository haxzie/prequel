/**
 * A menu is not shown before there is something in it.
 *
 * The same shape of bug `workspace.test.ts` opens with, in a different window:
 * `prepare` creates the window and starts a load, `loadRoute` is asynchronous,
 * and the content is pushed over IPC. Show the window in between and the push
 * has reached a renderer that has not executed a line of the bundle, so the
 * user gets an empty frosted rectangle above the pill — on the first open of a
 * launch and only the first, which is what makes it read as a glitch rather
 * than as a state anybody could describe.
 *
 * Nothing downstream can catch it. The menu is correct, the geometry is
 * correct, the push happens; the only thing wrong is the order, and the window
 * fills itself in a moment later.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every `did-finish-load` handler registered, so a test can run the load. */
const loadHandlers: (() => void)[] = [];
const shown: string[] = [];
const sent: unknown[] = [];

class FakeWindow {
  destroyed = false;
  webContents = {
    on: (event: string, handler: () => void) => {
      if (event === "did-finish-load") loadHandlers.push(handler);
    },
    send: (_channel: string, payload: unknown) => {
      sent.push(payload);
    },
  };
  setAlwaysOnTop() {}
  setBounds() {}
  isDestroyed() {
    return this.destroyed;
  }
  showInactive() {
    shown.push("shown");
  }
  hide() {}
  destroy() {
    this.destroyed = true;
  }
}

vi.mock("electron", () => ({
  screen: {
    getDisplayNearestPoint: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
}));

vi.mock("./base.js", () => ({
  createPanel: () => new FakeWindow(),
  // Deliberately never resolves on its own. A real load finishes when Chromium
  // says so, and the point of these tests is what happens before it does.
  loadRoute: () => new Promise<void>(() => undefined),
}));

const { DockMenuWindow } = await import("./dock-menu.js");

const MENU = { kind: "camera", devices: [], selectedId: null, anchorX: 100 } as never;
const DOCK = { x: 400, y: 900 };

beforeEach(() => {
  loadHandlers.length = 0;
  shown.length = 0;
  sent.length = 0;
});

describe("the first menu of a launch", () => {
  it("is not shown while its renderer is still loading", () => {
    const menus = new DockMenuWindow();
    menus.open(MENU, DOCK);

    expect(shown).toHaveLength(0);
  });

  it("is shown once the renderer has run, with the menu already pushed", () => {
    const menus = new DockMenuWindow();
    menus.open(MENU, DOCK);

    // What Chromium reports when the bundle has executed.
    for (const handler of loadHandlers) handler();

    expect(shown).toHaveLength(1);
    // Pushed before the window appeared, which is the whole point — a show
    // that races the content is the bug this file exists for.
    expect(sent.at(-1)).toBe(MENU);
  });

  it("stays hidden when it was closed again before it finished loading", () => {
    // Fast enough to open and close a menu inside a page load is unusual but
    // not impossible, and a menu that appeared *after* being dismissed would
    // be worse than one that appeared late.
    const menus = new DockMenuWindow();
    menus.open(MENU, DOCK);
    menus.open(null, DOCK);

    for (const handler of loadHandlers) handler();

    expect(shown).toHaveLength(0);
  });
});

describe("every menu after the first", () => {
  it("is shown straight away", () => {
    const menus = new DockMenuWindow();
    menus.open(MENU, DOCK);
    for (const handler of loadHandlers) handler();
    shown.length = 0;

    menus.open(MENU, DOCK);

    // No second load to wait for: the window is already there and holding a
    // renderer, so anything else would be a menu that lagged its own click.
    expect(shown).toHaveLength(1);
  });
});
