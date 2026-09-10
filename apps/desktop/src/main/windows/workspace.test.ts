/**
 * The window goes to a route, and is told where it went.
 *
 * This replaced a push. Main used to read the whole session and send it, having
 * announced first that one was coming, and both halves shipped as one bug:
 * pushing on `did-finish-load` sent everything to nobody, because every view is
 * a `lazy()` chunk fetched after the page has loaded. A finished take opened
 * the library.
 *
 * The second half is what made it a dead end rather than a wrong screen. Main
 * still believed that recording was open, so the request hit a
 * `current === verified` guard and returned without sending anything, and the
 * card the user then clicked sat reading "Opening…" for ever. The route is what
 * fixes that class: it is in the URL, so a window cannot disagree with main
 * about which recording it is on. The test below that opens the same recording
 * twice is the one that pins it.
 *
 * What is left for main to get right is the bookkeeping — `current`, the title,
 * and the flush that makes "nothing is pending on the grid" true — which the
 * renderer now reports both ends of.
 */
import { beforeEach, describe as suite, expect, it, vi } from "vitest";

const SESSION = { dir: "/recordings/take-1", slices: [] };

vi.mock("electron", () => ({ BrowserWindow: class {} }));

vi.mock("../editor-session.js", () => ({
  readEditorSession: () => Promise.resolve(SESSION),
}));

/** Every recording this test pretends exists, by name. */
const RECORDINGS = new Set(["take-1", "take-2"]);

vi.mock("../session.js", () => ({
  recordingPath: (name: string) => (RECORDINGS.has(name) ? `/recordings/${name}` : null),
}));

/** Which directories were flushed, in order. */
const flushed: string[] = [];
vi.mock("../editor-project.js", () => ({
  flushProject: (dir: string) => flushed.push(dir),
}));

vi.mock("../log.js", () => ({ mirrorConsole: () => undefined, log: () => undefined }));

vi.mock("node:fs", () => ({
  readFileSync: () => JSON.stringify({ version: 1 }),
}));

vi.mock("../../shared/manifest.js", () => ({
  MANIFEST_FILE_NAME: "session.json",
  parseManifest: (raw: string) => JSON.parse(raw) as unknown,
}));

interface Sent {
  channel: string;
  payload: unknown;
}

const sent: Sent[] = [];
const titles: string[] = [];

function fakeWindow() {
  return {
    webContents: {
      on: () => undefined,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    },
    isDestroyed: () => false,
    on: () => undefined,
    once: () => undefined,
    show: () => undefined,
    focus: () => undefined,
    close: () => undefined,
    setTitle: (title: string) => titles.push(title),
  };
}

/** The routes windows were created on. */
const loaded: string[] = [];

vi.mock("./base.js", () => ({
  createWindow: () => fakeWindow(),
  loadRoute: (_window: unknown, route: string) => {
    loaded.push(route);
    return Promise.resolve();
  },
}));

const { WorkspaceWindow } = await import("./workspace.js");

const channels = () => sent.map((entry) => entry.channel);
const payloads = (channel: string) =>
  sent.filter((entry) => entry.channel === channel).map((entry) => entry.payload);

let workspace: InstanceType<typeof WorkspaceWindow>;

beforeEach(() => {
  sent.length = 0;
  loaded.length = 0;
  titles.length = 0;
  flushed.length = 0;
  workspace = new WorkspaceWindow();
});

suite("opening a window", () => {
  it("loads it on the recording it was opened for", () => {
    workspace.open("/recordings/take-1");

    // Not `/workspace` and then a move. A window that always loaded the library
    // showed the grid for a frame on its way to an editor, which is the flash
    // the old `editor:opening` push existed to cover.
    expect(loaded).toEqual(["/editor/take-1"]);
    expect(sent).toHaveLength(0);
  });

  it("encodes the name, because every recording has spaces in it", () => {
    workspace.open("/recordings/Prequel 2026-09-10 04-44-38");

    // `loadRoute` concatenates its argument straight into a URL.
    expect(loaded).toEqual(["/editor/Prequel%202026-09-10%2004-44-38"]);
  });

  it("loads the library when it was opened without one", () => {
    workspace.open();

    expect(loaded).toEqual(["/workspace"]);
  });

  it("sends only the pane when the view says it is ready", () => {
    workspace.open("/recordings/take-1");
    workspace.ready();

    // The recording is in the route, so there is nothing left to tell a window
    // about itself but which pane of the library it should be on.
    expect(channels()).toEqual(["workspace:section"]);
  });
});

suite("moving a window that is already open", () => {
  it("navigates to the recording", () => {
    workspace.open();
    sent.length = 0;

    workspace.openRecording("/recordings/take-2");

    expect(payloads("workspace:navigate")).toEqual(["/editor/take-2"]);
  });

  it("navigates again for the recording already on screen", () => {
    workspace.open();
    workspace.enterRecording("take-1");
    sent.length = 0;

    // Main believing this one is open is not the same as the window showing it,
    // and a user whose window is on the library is exactly the user who asks
    // for it again. Silence here is what left a card reading "Opening…".
    workspace.openRecording("/recordings/take-1");

    expect(payloads("workspace:navigate")).toEqual(["/editor/take-1"]);
  });

  it("navigates to the library and says which pane", () => {
    workspace.open();
    sent.length = 0;

    workspace.showProjects("settings");

    expect(payloads("workspace:navigate")).toEqual(["/workspace"]);
    expect(payloads("workspace:section")).toEqual(["settings"]);
  });
});

suite("what main records about where the window is", () => {
  it("takes the recording and names the window after it", () => {
    workspace.open();

    expect(workspace.enterRecording("take-1")).toBe("/recordings/take-1");
    expect(workspace.currentDir).toBe("/recordings/take-1");
    expect(titles.at(-1)).toBe("take-1");
  });

  it("refuses a name that is not a recording in the library", () => {
    workspace.open();

    // The name arrives from a route, which anything can point at: a reload, an
    // HMR round trip, a hash somebody typed.
    expect(workspace.enterRecording("../elsewhere")).toBeNull();
    expect(workspace.currentDir).toBeNull();
  });

  it("flushes the edit being left behind before the next one loads", () => {
    workspace.open();
    workspace.enterRecording("take-1");
    flushed.length = 0;

    workspace.enterRecording("take-2");

    expect(flushed).toEqual(["/recordings/take-1"]);
    expect(workspace.currentDir).toBe("/recordings/take-2");
  });

  it("does not flush when the same recording is entered again", () => {
    workspace.open();
    workspace.enterRecording("take-1");
    flushed.length = 0;

    // A reload lands on the same route. Flushing here would be harmless today,
    // but it would also mean the pending edit is written and forgotten while
    // the editor that owns it is still on screen.
    workspace.enterRecording("take-1");

    expect(flushed).toEqual([]);
  });

  it("flushes and forgets the recording when the route leaves it", () => {
    workspace.open();
    workspace.enterRecording("take-1");
    flushed.length = 0;

    workspace.leaveRecording();

    // The invariant the whole design rests on: being off a recording means
    // nothing is held for it, so `projects.ts` can rename a `project.json` with
    // no live editor to race.
    expect(flushed).toEqual(["/recordings/take-1"]);
    expect(workspace.currentDir).toBeNull();
  });
});
