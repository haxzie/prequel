import { app, nativeTheme, protocol } from "electron";

import { validateEnv } from "@prequel/env";

import { flush, track } from "./analytics.js";
import { authState, onAuthChanged } from "./auth.js";
import { clearEntitlement, onEntitlementChanged, refreshEntitlement } from "./licence.js";
import { CaptureFlow } from "./capture-flow.js";
import { migrateLibrary } from "./library-migrate.js";
import { flushDeepLinks, handleDeepLinkArgv, registerDeepLinks } from "./deep-link.js";
import {
  broadcastAuthState,
  broadcastEntitlement,
  broadcastDockState,
  broadcastLoginItem,
  broadcastUpdateState,
  registerIpc,
} from "./ipc.js";
import { initLogging, log, logPath } from "./log.js";
import { loginItemState, seedLoginItem, startedByItself, wasOpenedAtLogin } from "./login-item.js";
import { missingPermissions } from "../shared/permissions.js";
import { permissionStates } from "./permissions.js";
import { getRecorder } from "./recorder.js";
import { MEDIA_SCHEME_PRIVILEGES, registerMediaProtocol } from "./media-protocol.js";
import { Preferences } from "./preferences.js";
import { RecordingSession } from "./session.js";
import { applyShortcuts, teardownShortcuts } from "./shortcuts.js";
import { AppTray } from "./tray.js";
import { checkForUpdates, checkForUpdatesIfDue, onUpdateChanged } from "./update.js";
import { CameraWindow } from "./windows/camera.js";
import { DockWindow } from "./windows/dock.js";
import { WorkspaceWindow } from "./windows/workspace.js";
import { SelectionOverlay } from "./windows/selection.js";
import { UpdateWindow } from "./windows/update.js";
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

// Before anything reads the library: the tray's recent list, an editor window
// restored from a previous run and the media protocol all resolve against the
// new layout, so a take still sitting in the old one would read as missing.
migrateLibrary();

// Only one instance may hold the tray icon and the global shortcut.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Must happen before `whenReady`, and at module scope rather than inside it:
// Chromium reads the privileged-scheme table while it starts up, and a
// registration afterwards is silently ignored. Without `stream` in particular
// the editor's video elements cannot seek.
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME_PRIVILEGES]);

// Also before `whenReady`, and for a related reason: launching the app *by*
// following a `prequel://` link fires `open-url` before the app is ready, and a
// listener attached later never hears the event that started the process. The
// URLs are queued until `flushDeepLinks` below.
registerDeepLinks();

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
 * user has to be able to get back to — there is no Cmd-Tab entry either. The
 * app window and the welcome window both need one, so the icon is shown while
 * any of them is open and hidden only once none is.
 */
function syncDockIcon(): void {
  if (workspace.isOpen || welcome.isOpen || updates.isOpen) void app.dock?.show();
  else app.dock?.hide();
}

const welcome = new WelcomeWindow({
  onOpen: () => syncDockIcon(),
  onClose: () => syncDockIcon(),
});

const updates = new UpdateWindow({
  onOpen: () => syncDockIcon(),
  onClose: () => syncDockIcon(),
});

const workspace = new WorkspaceWindow({
  // Open at login lives in macOS, so it can change while the Settings pane is
  // open in this window.
  onFocus: () => broadcastLoginItem(loginItemState()),
  onOpen: () => {
    flow?.workspaceOpened();
    syncDockIcon();
  },
  onClose: (fromCapture) => {
    // The project is still flushed on the way out — that happens in the
    // window's own `closed` handler, which runs either way.
    if (quitting) return;

    flow?.workspaceClosed(fromCapture);
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
//
// The argv is not ignored any more: macOS delivers a deep link this way when a
// second copy is launched to follow one while this instance holds the lock,
// which is the ordinary case for signing in with the app already running.
app.on("second-instance", (_event, argv) => {
  handleDeepLinkArgv(argv);
  flow?.open();
});

void app.whenReady().then(() => {
  registerMediaProtocol();

  // The editor's palette is dark whatever the system theme is; the workspace
  // window's vibrancy is not. An `NSVisualEffectView` takes its material from
  // the app's `NSAppearance`, so under a light system theme `under-window`
  // returns a pale frosted white for dark chrome to sit on — a bright halo
  // around the window and hairlines that vanish into it. Forcing the
  // appearance is the only lever there is: Electron has no per-window
  // equivalent, and the material cannot be told to disagree with its app.
  //
  // Nothing else moves. `--muted` in the camera bubble and in the unknown-route
  // fallback are the only two things in the tree reading the global light/dark
  // tokens, and both already sit on a dark surface.
  nativeTheme.themeSource = "dark";

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
    workspace,
    welcome,
    updates,
    // Every time the panel opens, throttled inside `update.ts`. The launch
    // check below is the only other one, and a menu-bar app can go weeks
    // between launches.
    checkForUpdates: checkForUpdatesIfDue,
  });

  registerIpc({ flow, workspace });
  tray = new AppTray(session, flow);

  // Several surfaces show the account, so they hear about it rather than each
  // polling for it.
  onAuthChanged(broadcastAuthState);
  onEntitlementChanged(broadcastEntitlement);

  // The licence follows the account. Signing out drops what was known about the
  // old one — otherwise signing out of a paid account and into a free one would
  // go on exporting on the previous answer — and signing in asks straight away,
  // so the first Export press after a sign-in is not the one that waits on a
  // round trip.
  onAuthChanged((state) => {
    if (state.status === "signed-out") clearEntitlement();
    else if (state.status === "signed-in") void refreshEntitlement();
  });

  // And once for a copy that was already signed in when it launched. Signing in
  // is a transition, and the handler above only ever fires on one — so an
  // install signed in last week has never asked, `entitlement()` answers
  // `unknown` for as long as it runs, and the sidebar cannot tell a trial from
  // a paid team. Export was the only thing that ever asked, which was enough
  // while export was the only thing that cared.
  //
  // One request per launch, not a poll: it costs a menu-bar app that is started
  // rarely almost nothing, and the answer changes about twice in a lifetime.
  if (authState().status === "signed-in") void refreshEntitlement();

  // The tray menu reads this directly when it is built, but the update window
  // and the Settings pane stay open across a whole download and have to be told.
  onUpdateChanged(broadcastUpdateState);

  // Now that `completeSignIn` has somewhere to report to. Covers both a link
  // that arrived before this point and the cold-launch case, where the URL is in
  // this process's own argv rather than in an event.
  flushDeepLinks();
  handleDeepLinkArgv(process.argv);

  /**
   * The panel, or the welcome window in front of it.
   *
   * Launching a menu-bar app is a deliberate act, and the only reason to do it
   * is to record something — so show the panel rather than making the user go
   * and find the tray icon first. `open` uses `showInactive`, so this still
   * does not steal focus from whatever they were doing.
   *
   * Unless a permission a recording needs is missing. Without Screen Recording
   * every part of the panel is present and none of it works; without
   * Accessibility it all works and quietly produces a take with one click in it
   * and no automatic zooms. Both read as a broken app rather than as a missing
   * permission — so the welcome window goes first, on the step that is the
   * reason it opened, and the panel follows when it is done.
   *
   * Checked on every launch rather than only the first: a permission can be
   * taken away again in System Settings, and replacing the bundle in place is
   * enough to strand one.
   */
  // A Mac that has never run Prequel gets the login item, so the recorder is
  // already in the menu bar the next time something worth capturing happens —
  // nobody goes looking for a screen recorder *before* the thing they wanted to
  // record. Seeded only while the welcome flow is unfinished, which is what
  // stops it reinstating itself after someone has turned it off.
  if (!preferences.get().welcomed) seedLoginItem();

  void (async () => {
    const states = await permissionStates();
    const granted = states.find((state) => state.id === "screen")?.granted;
    const chosen = preferences.get();

    /**
     * The same rule the panel's warning uses, from the same function.
     *
     * Not "anything ungranted": a camera nobody has switched on needs no camera
     * grant, and a window on every launch about a permission the user has
     * deliberately never wanted is one they learn to dismiss without reading —
     * which costs the two that matter their only way of being seen.
     */
    const missing = missingPermissions(states, {
      camera: chosen.cameraId !== null,
      microphone: chosen.micId !== null,
    });

    // The one event that answers the questions nothing here could: how many
    // installs there are, how many ever get past the Screen Recording prompt,
    // and which versions are still running. `first_launch` is read off
    // `welcomed` rather than a flag of its own — there is exactly one piece of
    // first-run state and a second one would eventually disagree with it.
    track("app_launched", {
      first_launch: !chosen.welcomed,
      opened_at_login: wasOpenedAtLogin(),
      screen_permission: granted === true,
    });

    // Never seen it: the whole flow, from the top.
    if (!chosen.welcomed) {
      welcome.open();
      return;
    }

    // Seen it, and something is still missing. Straight to the permissions
    // step — a returning user does not need to be welcomed to an app they
    // have been using.
    if (missing.length > 0) {
      log("info", `opening the welcome flow: ${missing.join(", ")} not granted`);
      welcome.open("permissions");
      return;
    }

    // At startup the app is running because the Mac is, not because anyone
    // asked it to — so it takes its place in the menu bar and stays out of the
    // way, and the tray icon opens the panel when there is something to record.
    // A panel and a camera bubble over the desktop every time the machine boots
    // is something to be dismissed, which is the opposite of what opening at
    // login is for.
    if (startedByItself()) log("info", "started by the system: staying in the menu bar");
    else flow!.open();

    /**
     * Then, quietly, whether there is a newer version.
     *
     * The window is shown on every launch while an update is pending rather
     * than once per version: launching is the only moment this app has anyone's
     * attention, and a recorder people open twice a week would otherwise take
     * months to notice.
     *
     * Not at startup, though — the rule above applies to this too, and a window
     * over the desktop every time the machine boots is something to be
     * dismissed rather than read. The check still runs, so the tray item has
     * the answer; only the window waits for a launch somebody meant.
     *
     * The welcome flow never reaches here at all, which is right: that user is
     * installing a fresh copy and has nothing to update.
     */
    const update = await checkForUpdates();
    if (update.status === "available" && !startedByItself()) updates.open();
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

  applyShortcuts(preferences.get().toggleShortcut, {
    onToggle: () => void flow?.toggleRecording(),
    onPause: () => void flow?.togglePause(),
  });
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
    ["shortcuts", () => teardownShortcuts()],
    ["selection", () => selection.close()],
    ["camera", () => camera.destroy()],
    ["dock", () => dock.destroy()],
    ["workspace", () => workspace.close()],
    ["welcome", () => welcome.close()],
    ["updates", () => updates.close()],
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

  // Started, not awaited. `before-quit` and `will-quit` must not throw and must
  // not block — an exception here abandons the quit and strands the app with no
  // way out but `kill -9` — so whatever has not been sent by now is lost, which
  // is the right trade for an analytics event.
  track("app_quit");
  void flush();
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
