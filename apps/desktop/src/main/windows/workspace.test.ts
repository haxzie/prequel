/**
 * The window is told what to show because it asked, not because it had loaded.
 *
 * Both of these shipped as one bug. Main pushed the section and the arriving
 * recording on `did-finish-load`, which fires when the *page* has loaded — and
 * every view is a `lazy()` chunk fetched after that, so nothing was listening
 * and `ipcRenderer` kept none of it. A finished take opened the library.
 *
 * The second half is what made it a dead end rather than a wrong screen. Main
 * still believed that recording was open, so `showProject` hit its
 * `current === verified` guard and returned without sending anything — and the
 * card the user then clicked sat reading "Opening…" for ever, with nothing in
 * the log to say why.
 */
import { beforeEach, describe as suite, expect, it, vi } from "vitest";

const SESSION = { dir: "/recordings/take-1", slices: [] };

vi.mock("electron", () => ({ BrowserWindow: class {} }));

vi.mock("../editor-session.js", () => ({
  readEditorSession: () => Promise.resolve(SESSION),
}));

vi.mock("../editor-project.js", () => ({ flushProject: () => undefined }));
vi.mock("../log.js", () => ({ mirrorConsole: () => undefined, log: () => undefined }));

/** Every recording this test pretends exists. */
const RECORDINGS = new Set(["/recordings/take-1", "/recordings/take-2"]);

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
    setTitle: () => undefined,
  };
}

vi.mock("./base.js", () => ({
  createWindow: () => fakeWindow(),
  loadRoute: () => Promise.resolve(),
}));

const { WorkspaceWindow } = await import("./workspace.js");

/** Lets the mocked `readEditorSession` promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const channels = () => sent.map((entry) => entry.channel);

let workspace: InstanceType<typeof WorkspaceWindow>;

beforeEach(() => {
  sent.length = 0;
  workspace = new WorkspaceWindow();
});

suite("a window that asks what to show", () => {
  it("sends nothing until it is asked", () => {
    workspace.open("/recordings/take-1");

    // The whole regression in one line: loading the page is not the moment a
    // listener exists, so nothing may be sent on the strength of it.
    expect(sent).toHaveLength(0);
  });

  it("sends the section and the arriving recording when the view is ready", async () => {
    workspace.open("/recordings/take-1");

    workspace.ready();
    await settle();

    expect(channels()).toContain("workspace:section");
    expect(channels()).toContain("editor:opening");
    expect(channels()).toContain("editor:open");
  });

  it("says it again when the recording already open is asked for", async () => {
    workspace.open("/recordings/take-1");
    workspace.ready();
    await settle();
    sent.length = 0;

    // Main already believes this one is open. The renderer may never have heard
    // — and a user whose window is on the library is exactly the user who
    // clicks it again. Silence here left the card reading "Opening…".
    workspace.showProject("/recordings/take-1");
    await settle();

    expect(channels()).toContain("editor:open");
  });

  it("still opens a different recording", async () => {
    workspace.open("/recordings/take-1");
    workspace.ready();
    await settle();
    sent.length = 0;

    workspace.showProject("/recordings/take-2");
    await settle();

    expect(channels()).toContain("editor:open");
  });

  it("sends only the section when the window is on the library", async () => {
    workspace.open();

    workspace.ready();
    await settle();

    expect(channels()).toEqual(["workspace:section"]);
  });
});
