import { app, globalShortcut, protocol } from "electron";

import { validateEnv } from "@prequel/env";

import { CaptureFlow } from "./capture-flow.js";
import { broadcastDockState, registerIpc } from "./ipc.js";
import { initLogging, log, logPath } from "./log.js";
import { getRecorder } from "./recorder.js";
import { MEDIA_SCHEME_PRIVILEGES, registerMediaProtocol } from "./media-protocol.js";
import { Preferences } from "./preferences.js";
import { RecordingSession } from "./session.js";
import { AppTray } from "./tray.js";
import { CameraWindow } from "./windows/camera.js";
import { DockWindow } from "./windows/dock.js";
import { EditorWindows } from "./windows/editor.js";
import { SelectionOverlay } from "./windows/selection.js";

// Without this, an unpackaged build takes its name from package.json and
// stores settings under "@prequel/desktop" — a scoped-package path nobody
// would think to look in. Packaged builds get this from `productName`.
// Set before logging, which puts its file under the app's name.
app.setName("Prequel");

// Before anything that can fail, so a startup crash lands in the log rather
// than in a console no packaged build has.
initLogging();

// Fail fast on a bad config rather than mid-session.
validateEnv();

/** Start/stop from anywhere, including while another app has focus. */
const TOGGLE_SHORTCUT = "Shift+Cmd+R";
const PAUSE_SHORTCUT = "Shift+Cmd+P";

// Only one instance may hold the tray icon and the global shortcut.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Must happen before `whenReady`, and at module scope rather than inside it:
// Chromium reads the privileged-scheme table while it starts up, and a
// registration afterwards is silently ignored. Without `stream` in particular
// the editor's video elements cannot seek.
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME_PRIVILEGES]);

const session = new RecordingSession();
const dock = new DockWindow();
const camera = new CameraWindow();
const selection = new SelectionOverlay();

let tray: AppTray | null = null;
let flow: CaptureFlow | null = null;

const editors = new EditorWindows({
  onFirstOpen: () => {
    flow?.editorOpened();
    // A menu-bar app has no Dock icon, which is right until it owns a real
    // window: without one the editor cannot be reached from Cmd-Tab or the
    // Dock, and hiding it again would minimise the editor out of reach.
    void app.dock?.show();
  },
  onLastClose: () => {
    flow?.editorClosed();
    app.dock?.hide();
  },
});

// Menu-bar app: no Dock icon, no window on launch. In a packaged build
// `LSUIElement` in Info.plist does this before the app even draws; calling
// `app.dock.hide()` covers `pnpm dev`, where there is no packaged plist.
if (!app.isPackaged) {
  app.dock?.hide();
}

// Relaunching a menu-bar app should reveal it rather than do nothing — there is
// no Dock icon to click.
app.on("second-instance", () => flow?.open());

void app.whenReady().then(() => {
  registerMediaProtocol();

  // Routes the addon's `tracing` output into the same file, so a Rust-side
  // warning during an export is not silently dropped.
  void getRecorder()
    .then((recorder) => recorder.setLogFile(logPath()))
    .catch((cause) => console.warn("[log] could not route native logs:", cause));

  // Constructed here: `Preferences` reads `app.getPath`, which throws earlier.
  flow = new CaptureFlow({
    session,
    dock,
    camera,
    selection,
    preferences: new Preferences(),
    onChange: broadcastDockState,
    editors,
  });

  registerIpc({ flow });
  tray = new AppTray(session, flow);

  // Launching a menu-bar app is a deliberate act, and the only reason to do it
  // is to record something — so show the panel rather than making the user go
  // and find the tray icon first. `open` uses `showInactive`, so this still
  // does not steal focus from whatever they were doing.
  flow.open();

  // The tray title and the panel both show elapsed time, so it has to tick even
  // when nothing else is happening — and both have to be pushed, because
  // neither of them hears about a second passing on its own.
  const ticker = setInterval(() => {
    if (!session.isBusy()) return;
    broadcastDockState(flow!.state());
    tray?.refresh();
  }, 1000);
  app.on("will-quit", () => clearInterval(ticker));

  globalShortcut.register(TOGGLE_SHORTCUT, () => void flow?.toggleRecording());
  globalShortcut.register(PAUSE_SHORTCUT, () => void flow?.togglePause());
});

/**
 * Teardown, step by step.
 *
 * Each step is isolated: an exception thrown out of `will-quit` aborts the
 * quit, which strands the app running with no way out — exactly the failure
 * this logging exists to catch. Whatever goes wrong here, the app still exits,
 * and the log says what it was.
 */
app.on("will-quit", () => {
  log("info", "will-quit: tearing down");

  for (const [name, teardown] of [
    ["shortcuts", () => globalShortcut.unregisterAll()],
    ["selection", () => selection.close()],
    ["camera", () => camera.destroy()],
    ["dock", () => dock.destroy()],
    ["editors", () => editors.closeAll()],
    ["tray", () => tray?.destroy()],
  ] as const) {
    try {
      teardown();
    } catch (cause) {
      log("error", `will-quit: ${name} teardown failed`, cause);
    }
  }

  log("info", "will-quit: done");
});

app.on("before-quit", () => log("info", "before-quit"));
app.on("quit", (_event, code) => log("info", `quit with code ${code}`));

// A menu-bar app has no windows most of the time; closing them must not quit.
app.on("window-all-closed", () => log("info", "window-all-closed (staying alive)"));

/**
 * Quits on a terminate signal.
 *
 * Electron installs no handler, so `kill` on a menu-bar app does nothing and
 * the only way out is `kill -9` — which skips teardown entirely and leaves a
 * half-written project behind.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log("info", `${signal} received, quitting`);
    app.quit();
  });
}
