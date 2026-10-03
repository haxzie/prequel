/**
 * The guide and the app, in step.
 *
 * `prequel guide` is read by an agent before it does anything, and it is
 * generated from the catalogue rather than from the handlers. So the one thing
 * worth a test is that the two agree: a command described and not implemented
 * is a tool that documents something it then refuses to run, and a command
 * implemented and not described is one nothing will ever call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Whether the app under test is a shipped build.
 *
 * Mutable because `upgrade` is the one command whose first question is this,
 * and both answers are worth a test: a development build cannot update itself,
 * and the shipped path is the one nobody can try by hand without replacing the
 * copy in /Applications.
 */
const app = { packaged: false };

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.0.0",
    getName: () => "Prequel",
    getPath: () => "/tmp/prequel-cli-test",
    getAppPath: () => "/tmp/prequel-cli-test/app",
    get isPackaged() {
      return app.packaged;
    },
    on: () => {},
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1 }),
  },
  shell: { trashItem: () => Promise.resolve(), showItemInFolder: () => {}, openExternal: () => {} },
  dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) },
  webContents: { getAllWebContents: () => [] },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  net: {},
}));

// `update.ts` reaches for this at import time. The command map is all this
// file builds — nothing here checks for an update — so a stub is enough, and a
// real `electron-updater` would try to read the running app's feed.
vi.mock("electron-updater", () => ({
  // A default export, because `update.ts` destructures the module object:
  // electron-updater is CommonJS and its named exports do not survive the
  // interop. See the note at the top of `main/update.ts`.
  default: {
    autoUpdater: {
      on: () => {},
      autoDownload: false,
      autoInstallOnAppQuit: false,
      setFeedURL: () => {},
      checkForUpdates: () => Promise.resolve(null),
      downloadUpdate: () => Promise.resolve([]),
      quitAndInstall: () => {},
      logger: null,
    },
  },
  autoUpdater: {
    on: () => {},
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL: () => {},
    checkForUpdates: () => Promise.resolve(null),
    downloadUpdate: () => Promise.resolve([]),
    quitAndInstall: () => {},
    logger: null,
  },
  CancellationToken: class {},
}));

/** What the updater says, and what the handler did to it. */
const updates = {
  found: {
    status: "idle",
    current: "0.0.1",
    version: null as string | null,
    notes: null,
    percent: 0,
    message: null as string | null,
  },
  downloaded: {
    status: "ready",
    current: "0.0.1",
    version: "0.0.2",
    notes: null,
    percent: 100,
    message: null as string | null,
  },
  installs: 0,
  shims: 0,
};

vi.mock("../update.js", () => ({
  checkForUpdates: () => Promise.resolve(updates.found),
  downloadUpdate: () => Promise.resolve(updates.downloaded),
  installUpdate: () => void (updates.installs += 1),
  onUpdateChanged: () => () => {},
}));

vi.mock("./shim.js", () => ({
  installShim: () => {
    updates.shims += 1;
    return { path: "/tmp/prequel-cli-test/bin/prequel", changed: true };
  },
}));

const { cliHandlers, differences } = await import("./commands.js");
const { COMMANDS, commandName } = await import("../../shared/cli.js");

/** Enough of a context to build the map. */
function handlers(session: { isBusy?: () => boolean; snapshot?: () => unknown } = {}) {
  return cliHandlers({
    flow: {} as never,
    session: { isBusy: () => false, snapshot: () => ({ status: "idle" }), ...session } as never,
    preferences: {} as never,
  });
}

/** Nothing to report; `upgrade`'s progress is not what these are about. */
const quiet = () => {};

describe("the handler map", () => {
  it("implements every command the guide describes", () => {
    const missing = COMMANDS.filter(
      (command) => command.local !== true && !(commandName(command.path) in handlers()),
    ).map((command) => commandName(command.path));

    expect(missing).toEqual([]);
  });

  it("describes every command it implements", () => {
    const names = new Set(COMMANDS.map((command) => commandName(command.path)));
    const undocumented = Object.keys(handlers()).filter((name) => !names.has(name));

    expect(undocumented).toEqual([]);
  });

  it("leaves the catalogue's local commands to the CLI", () => {
    // `filters list` and the rest are answered out of the bundle, with the app
    // closed. One of them appearing here would mean the app had to be launched
    // to answer a question about a list of looks that cannot change.
    const local = COMMANDS.filter((command) => command.local === true).map((command) =>
      commandName(command.path),
    );

    for (const name of local) {
      expect(Object.keys(handlers()), name).not.toContain(name);
    }
  });
});

describe("differences", () => {
  it("says nothing about an unchanged document", () => {
    const project = { frame: { width: 1920 }, zooms: [{ scale: 2 }] };
    expect(differences(project, structuredClone(project))).toEqual([]);
  });

  it("names the leaf that moved, not its parents", () => {
    // What an agent needs is the line to fix. "Something under defaults
    // changed" is what a deep equality check would have said.
    expect(
      differences(
        { defaults: { layout: { cameraWidth: 1.8, cameraHeight: 0.3 } } },
        { defaults: { layout: { cameraWidth: 1, cameraHeight: 0.3 } } },
      ),
    ).toEqual(["defaults.layout.cameraWidth"]);
  });

  it("reports a dropped slice as a length change rather than an element each", () => {
    // The sanitiser drops a slice that spans a seam. Saying so once beats one
    // line per field of the slice that is no longer there.
    const changed = differences({ slices: [{ id: "a" }, { id: "b" }] }, { slices: [{ id: "a" }] });
    expect(changed).toEqual(["slices[] (2 → 1)"]);
  });

  it("notices a field the sanitiser removed", () => {
    expect(differences({ texts: [], stray: true }, { texts: [] })).toEqual(["stray"]);
  });
});

describe("upgrade", () => {
  beforeEach(() => {
    app.packaged = true;
    updates.installs = 0;
    updates.shims = 0;
    updates.found = {
      status: "idle",
      current: "0.0.1",
      version: null,
      notes: null,
      percent: 0,
      message: null,
    };
  });

  it("refuses a development build rather than reporting it up to date", async () => {
    // It would be: `checkForUpdates` answers `idle` when the app is not
    // packaged. "You are on the latest version" to somebody running from
    // source is a lie that sends them looking for the wrong bug.
    app.packaged = false;

    await expect(handlers()["upgrade"]!({}, quiet)).rejects.toThrow(/development build/);
    expect(updates.installs).toBe(0);
  });

  it("refuses while a take is running, before touching the updater", async () => {
    // Installing quits the app, which tears the recorder down mid-capture and
    // leaves the take unfinished on disk with nothing to say why.
    const busy = { isBusy: () => true, snapshot: () => ({ status: "recording" }) };

    await expect(handlers(busy)["upgrade"]!({}, quiet)).rejects.toThrow(/stop the take first/);
    expect(updates.installs).toBe(0);
  });

  it("rewrites the shim even when there is nothing to download", async () => {
    // The half of "upgrade" that needs no network: the command pointing at this
    // copy of the app is what breaks when somebody moves Prequel.
    const answer = (await handlers()["upgrade"]!({}, quiet)) as { status: string; cli: unknown };

    expect(answer.status).toBe("current");
    expect(answer.cli).toMatchObject({ rewritten: true });
    expect(updates.shims).toBe(1);
    expect(updates.installs).toBe(0);
  });

  it("installs nothing under --check", async () => {
    updates.found = { ...updates.found, status: "available", version: "0.0.2" };

    const answer = (await handlers()["upgrade"]!({ check: true }, quiet)) as {
      status: string;
      version: string;
      restarting: boolean;
    };

    expect(answer).toMatchObject({ status: "available", version: "0.0.2", restarting: false });
    expect(updates.installs).toBe(0);
  });

  it("answers before it quits to install", async () => {
    // The install is on a timer so the answer reaches the client first: a
    // command killed mid-sentence by its own success reads as a failure.
    vi.useFakeTimers();
    updates.found = { ...updates.found, status: "available", version: "0.0.2" };

    try {
      const answer = (await handlers()["upgrade"]!({}, quiet)) as {
        status: string;
        restarting: boolean;
      };

      expect(answer).toMatchObject({ status: "installing", restarting: true });
      expect(updates.installs, "quit before the answer was written").toBe(0);

      vi.runAllTimers();
      expect(updates.installs).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the download did not finish, and installs nothing", async () => {
    updates.found = { ...updates.found, status: "available", version: "0.0.2" };
    updates.downloaded = {
      status: "error",
      current: "0.0.1",
      version: "0.0.2",
      notes: null,
      percent: 0,
      message: "Prequel couldn't download the update.",
    };

    await expect(handlers()["upgrade"]!({}, quiet)).rejects.toThrow(/couldn't download/);
    expect(updates.installs).toBe(0);

    updates.downloaded = {
      status: "ready",
      current: "0.0.1",
      version: "0.0.2",
      notes: null,
      percent: 100,
      message: null,
    };
  });
});
