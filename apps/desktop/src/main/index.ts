import { app, globalShortcut, protocol } from "electron";

import { validateEnv } from "@prequel/env";

import { CaptureFlow } from "./capture-flow.js";
import { broadcastDockState, registerIpc } from "./ipc.js";
import { initLogging, log, logPath } from "./log.js";
import { seedLoginItem, wasOpenedAtLogin } from "./login-item.js";
import { permissionStates } from "./permissions.js";
import { getRecorder } from "./recorder.js";
import { MEDIA_SCHEME_PRIVILEGES, registerMediaProtocol } from "./media-protocol.js";
import { Preferences } from "./preferences.js";
import { RecordingSession } from "./session.js";
import { AppTray } from "./tray.js";
import { CameraWindow } from "./windows/camera.js";
import { DockWindow } from "./windows/dock.js";
import { EditorWindows } from "./windows/editor.js";
import { SelectionOverlay } from "./windows/selection.js";
import { WelcomeWindow } from "./windows/welcome.js";

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

/**
 * True from `before-quit` onwards, so teardown is not mistaken for ordinary use.
 *
 * Quitting closes every window, and closing the last editor window normally
 * means "the user finished editing, bring the recorder back". During a quit it
 * means nothing of the sort, and acting on it reaches for a camera bubble
 * Electron has already destroyed — which throws *between* `before-quit` and
 * `will-quit`, and an exception there abandons the quit and strands the app
 * running with no way out but `kill -9`.
 */
let quitting = false;

/**
 * Whether a real window of ours is on screen.
 *
 * A menu-bar app has no Dock icon, which is right until it owns a window the
 * user has to be able to get back to — there is no Cmd-Tab entry either. Both
 * the editor and the welcome window need one, so the icon is shown while either
 * is open and hidden only once neither is.
 */
function syncDockIcon(): void {
  if (editors.openCount > 0 || welcome.isOpen) void app.dock?.show();
  else app.dock?.hide();
}

const welcome = new WelcomeWindow({
  onOpen: () => syncDockIcon(),
  onClose: () => syncDockIcon(),
});

const editors = new EditorWindows({
  onFirstOpen: () => {
    flow?.editorOpened();
    syncDockIcon();
  },
  onLastClose: () => {
    // The project is still flushed on the way out — that happens in the
    // window's own `closed` handler, which runs either way.
    if (quitting) return;

    flow?.editorClosed();
    syncDockIcon();
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
  const preferences = new Preferences();

  flow = new CaptureFlow({
    session,
    dock,
    camera,
    selection,
    preferences,
    onChange: broadcastDockState,
    editors,
    welcome,
  });

  registerIpc({ flow });
  tray = new AppTray(session, flow);

  /**
   * The panel, or the welcome window in front of it.
   *
   * Launching a menu-bar app is a deliberate act, and the only reason to do it
   * is to record something — so show the panel rather than making the user go
   * and find the tray icon first. `open` uses `showInactive`, so this still
   * does not steal focus from whatever they were doing.
   *
   * Unless the app cannot record. Without Screen Recording every part of the
   * panel is present and none of it works, which reads as a broken app rather
   * than as a missing permission — so the welcome window goes first, and the
   * panel follows when it is done. Checked on every launch rather than only the
   * first: a permission can be taken away again in System Settings.
   */
  // A Mac that has never run Prequel gets the login item, so the recorder is
  // already in the menu bar the next time something worth capturing happens —
  // nobody goes looking for a screen recorder *before* the thing they wanted to
  // record. Seeded only while the welcome flow is unfinished, which is what
  // stops it reinstating itself after someone has turned it off.
  if (!preferences.get().welcomed) seedLoginItem();

  void (async () => {
    const granted = (await permissionStates()).find((state) => state.id === "screen")?.granted;

    if (!preferences.get().welcomed || !granted) {
      welcome.open();
      return;
    }

    // At login the app is starting because the Mac did, not because anyone
    // asked it to — so it takes its place in the menu bar and stays out of the
    // way. A panel over the desktop every time the machine boots is something
    // to be dismissed, which is the opposite of what opening at login is for.
    if (wasOpenedAtLogin()) log("info", "opened at login: staying in the menu bar");
    else flow!.open();
  })();

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
    ["welcome", () => welcome.close()],
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

// Set here rather than in `will-quit`: the windows are closed between the two,
// and it is those closures that must not be read as the user finishing up.
app.on("before-quit", () => {
  quitting = true;
  log("info", "before-quit");
});
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
