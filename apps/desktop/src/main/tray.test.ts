/**
 * The menu-bar clock.
 *
 * The tray subscribes to the session, but the session only emits on state
 * *transitions* — start, pause, stop. A second passing is not a transition, so
 * something has to push the tray on a beat or the clock sits frozen at the
 * value it had when recording began. That wiring is what these cover; it is
 * invisible from the code and was broken once already.
 */
import { tmpdir } from "node:os";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionState } from "../shared/contract.js";
import { IDLE_SESSION } from "../shared/contract.js";

const titles: string[] = [];
const images: string[] = [];
/** Flipped by the test that checks an unreadable icon is reported. */
let iconIsEmpty = false;
/**
 * What `getBounds` answers, flipped by the placement tests.
 *
 * A zero height is macOS saying the item has no slot in the menu bar — which
 * is what the real one returns before it has been placed, and what it keeps
 * returning if it never is.
 */
let trayBounds = { x: 1065, y: 0, width: 32, height: 33 };

vi.mock("electron", () => {
  class FakeTray {
    constructor(image: string) {
      images.push(image);
    }
    getBounds() {
      return trayBounds;
    }
    isDestroyed() {
      return false;
    }
    setTitle(title: string) {
      titles.push(title);
    }
    setImage(image: string) {
      images.push(image);
    }
    setToolTip() {}
    setIgnoreDoubleClickEvents() {}
    on() {}
    destroy() {}
    popUpContextMenu() {}
  }

  return {
    Tray: FakeTray,
    Menu: { buildFromTemplate: () => ({}) },
    app: {
      quit: () => {},
      getVersion: () => "0.0.0",
      getName: () => "Prequel",
      isPackaged: false,
      // The Open at Login item reads this every time the menu is built.
      getLoginItemSettings: () => ({ openAtLogin: false, wasOpenedAtLogin: false }),
      setLoginItemSettings: () => {},
      // The logger writes here; a scratch path keeps the test off the real
      // `~/Library/Logs`.
      getPath: () => tmpdir(),
    },
    shell: { openPath: async () => "", showItemInFolder: () => {} },
    nativeImage: {
      // The path identifies which icon was chosen; the object only has to
      // survive `setTemplateImage`.
      createFromPath: (path: string) => ({
        setTemplateImage: () => {},
        // The real one returns an empty image for a path it cannot read —
        // which is what the tray now checks for, so the fake has to answer.
        isEmpty: () => iconIsEmpty,
        toString: () => path,
        path,
      }),
    },
  };
});

const { AppTray, formatElapsed } = await import("./tray.js");

/** A session stub whose state the test controls outright. */
function fakeSession(state: SessionState) {
  return {
    subscribe: (listener: (s: SessionState) => void) => {
      listener(state);
      return () => {};
    },
    snapshot: () => state,
  };
}

beforeEach(() => {
  titles.length = 0;
  images.length = 0;
});

describe("the tray clock", () => {
  it("shows nothing while idle", () => {
    new AppTray(fakeSession({ ...IDLE_SESSION }) as never, {} as never);
    expect(titles).toEqual([""]);
  });

  it("follows elapsed time when refreshed", () => {
    // The regression: without a push, this stays at whatever it was when the
    // recording started, however long the take runs.
    const state: SessionState = { ...IDLE_SESSION, status: "recording", elapsedMs: 0 };
    const tray = new AppTray(fakeSession(state) as never, {} as never);

    expect(titles.at(-1)).toBe("0:00");

    state.elapsedMs = 7_000;
    tray.refresh();
    expect(titles.at(-1)).toBe("0:07");

    state.elapsedMs = 3_725_000;
    tray.refresh();
    expect(titles.at(-1)).toBe("1:02:05");
  });

  it("keeps showing the time while paused", () => {
    // Paused is still a live recording; blanking the clock would read as
    // "stopped", which is exactly the wrong thing to imply.
    const state: SessionState = { ...IDLE_SESSION, status: "paused", elapsedMs: 42_000 };
    const tray = new AppTray(fakeSession(state) as never, {} as never);

    tray.refresh();
    expect(titles.at(-1)).toBe("0:42");
  });

  it("clears the clock once the session goes idle", () => {
    const state: SessionState = { ...IDLE_SESSION, status: "recording", elapsedMs: 5_000 };
    const tray = new AppTray(fakeSession(state) as never, {} as never);

    state.status = "idle";
    state.elapsedMs = 0;
    tray.refresh();

    expect(titles.at(-1)).toBe("");
  });
});

describe("formatElapsed", () => {
  it("counts in m:ss until an hour, then h:mm:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(69_000)).toBe("1:09");
    expect(formatElapsed(3_599_000)).toBe("59:59");
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
  });
});

describe("the tray icon", () => {
  it("reports an icon it could not read", () => {
    // The failure this check exists for: `nativeImage.createFromPath` cannot
    // read through asar, so an icon left inside the archive comes back empty.
    // An empty image is an invisible menu-bar item — and since `LSUIElement`
    // gives the app no menu of its own, that leaves no way to quit it at all.
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    iconIsEmpty = true;
    try {
      new AppTray(fakeSession(IDLE_SESSION) as never, {} as never);
    } finally {
      iconIsEmpty = false;
      console.error = original;
    }

    expect(errors.some((args) => String(args[0]).includes("tray icon is empty"))).toBe(true);
  });

  it("reports an icon that never reached the menu bar", () => {
    // The failure the empty-image check above cannot see: the icon loaded, the
    // `Tray` was constructed, and macOS put the item nowhere the user can reach
    // — a full menu bar, or a menu-bar manager that hides new items. With
    // `LSUIElement` the menu bar is the only way in *and* the only way out, so
    // this is the difference between "the user has not looked" and "there is
    // nothing to look at".
    vi.useFakeTimers();
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    trayBounds = { x: 0, y: 982, width: 32, height: 0 };
    try {
      new AppTray(fakeSession(IDLE_SESSION) as never, {} as never);
      vi.runAllTimers();
    } finally {
      trayBounds = { x: 1065, y: 0, width: 32, height: 33 };
      console.error = original;
      vi.useRealTimers();
    }

    expect(errors.some((args) => String(args[0]).includes("never reached the menu bar"))).toBe(
      true,
    );
  });

  it("says nothing when the item is placed", () => {
    vi.useFakeTimers();
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      new AppTray(fakeSession(IDLE_SESSION) as never, {} as never);
      vi.runAllTimers();
    } finally {
      console.error = original;
      vi.useRealTimers();
    }

    expect(errors).toEqual([]);
  });

  it("says nothing when the icon loads", () => {
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      new AppTray(fakeSession(IDLE_SESSION) as never, {} as never);
    } finally {
      console.error = original;
    }

    expect(errors.some((args) => String(args[0]).includes("tray icon is empty"))).toBe(false);
  });
});
