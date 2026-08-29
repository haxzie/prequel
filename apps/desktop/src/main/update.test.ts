/**
 * The update state machine.
 *
 * Every surface that shows an update — the window, the tray menu, the Settings
 * pane — draws from this one state, and none of them can see the updater that
 * moves it. What these cover is the wiring between the two: that an event from
 * Squirrel reaches a subscriber, that a check which finds nothing does not leave
 * the app saying "Checking…" for ever, and that the changelog is allowed to fail
 * on its own without taking the update down with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateState } from "../shared/contract.js";

/** Squirrel's events, kept so a test can fire one. */
const events = new Map<string, (payload: unknown) => void>();

const updater = {
  autoDownload: true,
  autoInstallOnAppQuit: false,
  disableDifferentialDownload: false,
  logger: null as unknown,
  feedUrl: null as unknown,
  setFeedURL: vi.fn((options: unknown) => {
    updater.feedUrl = options;
  }),
  on: vi.fn((event: string, handler: (payload: unknown) => void) => {
    events.set(event, handler);
  }),
  checkForUpdates: vi.fn(async () => ({})),
  downloadUpdate: vi.fn(async () => []),
  quitAndInstall: vi.fn(),
};

let packaged = true;

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return packaged;
    },
    getVersion: () => "0.0.2",
  },
  shell: { openExternal: vi.fn(async () => {}) },
}));

vi.mock("electron-updater", () => ({ default: { autoUpdater: updater } }));

vi.mock("./log.js", () => ({ log: () => {} }));

const notes = vi.fn(async (_path: string) => ({ notes: "- Faster exports" as string | null }));
vi.mock("./api.js", () => ({
  apiUrl: () => "https://api.prequel.sh",
  appUrl: () => "https://prequel.sh",
  apiFetch: (path: string) => notes(path),
}));

/**
 * A fresh module per test.
 *
 * The state and the "already configured" flag are module-scoped — which is
 * right, there is one updater — so they have to be reset by re-importing rather
 * than by a seam that exists only for tests.
 */
async function load() {
  vi.resetModules();
  events.clear();
  return import("./update.js");
}

beforeEach(() => {
  packaged = true;
  vi.clearAllMocks();
  notes.mockResolvedValue({ notes: "- Faster exports" });
});

describe("checking", () => {
  it("does nothing at all in an unpacked build", async () => {
    // `pnpm dev` has no bundle to replace and should not be calling the Worker
    // to find that out. An update path that half-works under a dev server is
    // worse to reason about than one that plainly does not run.
    packaged = false;
    const update = await load();

    expect((await update.checkForUpdates()).status).toBe("idle");
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.setFeedURL).not.toHaveBeenCalled();
  });

  it("points the updater at the API before it ever checks", async () => {
    // `AppUpdater` memoises its provider on the first check and ignores every
    // later `setFeedURL`, so this cannot be left until something asks.
    const update = await load();
    await update.checkForUpdates();

    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: `https://api.prequel.sh/v1/updates/darwin-${process.arch}`,
      useMultipleRangeRequest: false,
    });
  });

  it("turns off the delta path GitHub cannot serve", async () => {
    // GitHub's asset host answers 501 to the multi-range request the generic
    // provider sends, so the differential download can only ever cost a wasted
    // round trip before falling back.
    const update = await load();
    await update.checkForUpdates();

    expect(updater.disableDifferentialDownload).toBe(true);
    expect(updater.autoDownload).toBe(false);
  });

  it("comes to rest on idle when there is nothing to offer", async () => {
    // The regression this guards: neither event fires, and every surface sits
    // on "Checking…" until the app is restarted.
    const update = await load();

    expect((await update.checkForUpdates()).status).toBe("idle");
  });

  it("reports a check that never answers rather than staying busy", async () => {
    // The one that reads as a broken updater. A stalled connection neither
    // resolves nor rejects, so without a deadline the state sits on `checking`
    // for as long as the socket does — a Check for Updates button that disables
    // itself and never comes back. Seen for real on a route to GitHub's asset
    // host that takes 45 seconds to connect.
    vi.useFakeTimers();
    try {
      const update = await load();
      updater.checkForUpdates.mockReturnValueOnce(new Promise(() => {}));

      const checking = update.checkForUpdates();
      await vi.advanceTimersByTimeAsync(30_000);

      const state = await checking;
      expect(state.status).toBe("error");
      expect(state.message).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a check that threw rather than staying busy", async () => {
    const update = await load();
    updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));

    const state = await update.checkForUpdates();
    expect(state.status).toBe("error");
    expect(state.message).toBeTruthy();
  });
});

describe("the state a surface sees", () => {
  it("carries the running version, whatever else is happening", async () => {
    const update = await load();
    expect(update.updateState().current).toBe("0.0.2");
  });

  it("walks from available to ready as Squirrel reports in", async () => {
    const update = await load();
    const seen: UpdateState[] = [];
    update.onUpdateChanged((state) => seen.push(state));

    await update.checkForUpdates();

    events.get("update-available")!({ version: "0.0.3" });
    expect(update.updateState()).toMatchObject({ status: "available", version: "0.0.3" });

    events.get("download-progress")!({ percent: 41.6 });
    expect(update.updateState()).toMatchObject({ status: "downloading", percent: 42 });

    events.get("update-downloaded")!({ version: "0.0.3" });
    expect(update.updateState()).toMatchObject({ status: "ready", percent: 100 });

    // Every one of those reached the subscriber: the window and the Settings
    // pane stay open across the whole sequence and see nothing otherwise.
    expect(seen.map((state) => state.status)).toContain("downloading");
  });

  it("fills in the changelog after the version, not with it", async () => {
    const update = await load();
    await update.checkForUpdates();

    events.get("update-available")!({ version: "0.0.3" });
    await vi.waitFor(() => expect(update.updateState().notes).toBe("- Faster exports"));

    expect(notes).toHaveBeenCalledWith("/v1/updates/notes?version=0.0.3");
  });

  it("still offers the update when the changelog cannot be fetched", async () => {
    // A changelog that did not arrive is a window without a changelog. It must
    // not read as a failed check — the update itself is unaffected.
    notes.mockRejectedValueOnce(new Error("offline"));
    const update = await load();
    await update.checkForUpdates();

    events.get("update-available")!({ version: "0.0.3" });
    await Promise.resolve();

    expect(update.updateState()).toMatchObject({ status: "available", notes: null });
  });

  it("turns a Squirrel failure into something worth reading", async () => {
    const update = await load();
    await update.checkForUpdates();

    events.get("error")!(new Error("Code signature at URL ... did not pass validation"));

    const state = update.updateState();
    expect(state.status).toBe("error");
    expect(state.message).not.toContain("Code signature");
  });
});

describe("downloading and installing", () => {
  it("will not start without a version to fetch", async () => {
    const update = await load();
    await update.downloadUpdate();

    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("retries after a failure without needing a second check", async () => {
    const update = await load();
    await update.checkForUpdates();
    events.get("update-available")!({ version: "0.0.3" });

    updater.downloadUpdate.mockRejectedValueOnce(new Error("connection reset"));
    expect((await update.downloadUpdate()).status).toBe("error");

    // The version is still known, so the window's button works again.
    await update.downloadUpdate();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it("only quits for an update that is actually on disk", async () => {
    const update = await load();
    await update.checkForUpdates();
    events.get("update-available")!({ version: "0.0.3" });

    update.installUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    events.get("update-downloaded")!({ version: "0.0.3" });
    update.installUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });
});

/**
 * The check the panel makes.
 *
 * Everything here is about a request that nobody asked for. The panel is opened
 * by a gesture — several times in a minute while a window is chosen, and then
 * not again for days — so the throttle is the whole feature, and it is the kind
 * of thing that works perfectly in a manual test either way.
 */
describe("the background check", () => {
  it("asks the first time the panel opens", async () => {
    const update = await load();
    update.checkForUpdatesIfDue();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());
  });

  it("does not ask again while the last answer is fresh", async () => {
    const update = await load();

    update.checkForUpdatesIfDue();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());

    // Opening and closing the panel four more times, which is an ordinary
    // minute of choosing what to record.
    for (let press = 0; press < 4; press += 1) update.checkForUpdatesIfDue();

    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("asks again once the answer has gone stale", async () => {
    vi.useFakeTimers();

    try {
      const update = await load();
      update.checkForUpdatesIfDue();
      await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());

      vi.advanceTimersByTime(31 * 60 * 1000);
      update.checkForUpdatesIfDue();

      await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("never holds back a check somebody asked for", async () => {
    const update = await load();

    update.checkForUpdatesIfDue();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());

    // The tray's "Check for Updates…" — pressed by somebody who wants an answer
    // now, and a throttle that swallowed it would be a menu item that does
    // nothing.
    await update.checkForUpdates();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("counts a check that failed, so a machine offline does not ask on every press", async () => {
    const update = await load();

    updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    update.checkForUpdatesIfDue();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());

    update.checkForUpdatesIfDue();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });
});
