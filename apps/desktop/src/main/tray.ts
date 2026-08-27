/**
 * The menu-bar presence: icon, click-to-open panel, and right-click menu.
 */
import { fileURLToPath } from "node:url";

import { app, Menu, nativeImage, shell, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { authState, beginSignIn, openDashboard } from "./auth.js";
import type { CaptureFlow } from "./capture-flow.js";
import { log, logPath } from "./log.js";
import type { RecordingSession, SessionState } from "./session.js";
import { acceleratorGlyphs } from "../shared/accelerator.js";
import { listProjects } from "./projects.js";
import { revealRecordings } from "./session.js";
import { boundToggle } from "./shortcuts.js";
import { checkForUpdates, installUpdate, updateState } from "./update.js";

/** How many past recordings the Open Recent submenu offers. */
const RECENT_LIMIT = 10;

/**
 * How long macOS is given to place the status item before it is checked.
 *
 * `getBounds` answers an empty rect until the item has a slot in the menu bar —
 * measured, not assumed: immediately after `new Tray` it reads
 * `{x: 0, y: <below the screen>, width: 32, height: 0}`, and settles about a
 * third of a second later. Anything past that is long enough.
 */
const PLACEMENT_MS = 1500;

/**
 * The global shortcut, written the way a menu bar writes it.
 *
 * The one thing still worth telling a user whose tray icon is nowhere to be
 * seen, because it is the only part of the app that does not go through it.
 *
 * Read from what is actually bound rather than written out here: the chord is
 * remappable now, and a hint naming a shortcut the user has changed is worse
 * than no hint at all.
 */
function toggleHint(): string {
  const bound = boundToggle();
  return bound ? acceleratorGlyphs(bound) : "the shortcut";
}

function icon(name: string) {
  // Relative to `out/main/`, where electron-vite emits the bundled main
  // process — not to this source file.
  const path = fileURLToPath(new URL(`../../resources/${name}.png`, import.meta.url));
  const image = nativeImage.createFromPath(path);

  // `createFromPath` is native code and does not read through asar, so an icon
  // packed inside the archive silently comes back empty — and an empty tray
  // image is an invisible menu-bar item, which for a `LSUIElement` app means no
  // way to quit at all. `asarUnpack` in electron-builder.yml keeps these on the
  // real filesystem; this is the check that says so if it ever stops.
  if (image.isEmpty()) {
    // `console.error` rather than `log`: it is mirrored into the log file *and*
    // reaches the terminal under `pnpm dev`, and this is a failure worth
    // tripping over while developing rather than only after installing.
    console.error(`tray icon is empty — nothing will be clickable: ${path}`);
  }

  // Without this macOS will not invert the icon for dark menu bars or for the
  // highlighted state, and it looks wrong in half the configurations.
  image.setTemplateImage(true);
  return image;
}

export class AppTray {
  private readonly tray: Tray;
  private readonly idle = icon("idleTemplate");
  private readonly recording = icon("recordingTemplate");

  constructor(
    private readonly session: RecordingSession,
    private readonly flow: CaptureFlow,
  ) {
    this.tray = new Tray(this.idle);
    this.tray.setToolTip("Prequel");
    // Keeps the icon in the same menu-bar slot across launches.
    this.tray.setIgnoreDoubleClickEvents(true);

    // Left click toggles the panel. Deliberately no context menu is attached:
    // on macOS, setting one suppresses the click event entirely.
    this.tray.on("click", () => this.flow.toggle());
    this.tray.on("right-click", () => this.tray.popUpContextMenu(this.contextMenu()));

    this.session.subscribe((state) => this.render(state));
    log("info", "tray ready");
    this.reportPlacement();
  }

  /**
   * Says whether the icon actually reached the menu bar.
   *
   * "tray ready" only means the `Tray` was constructed, and a constructed tray
   * that is nowhere on screen is the one failure this app cannot survive: the
   * menu bar is the only way in and, with `LSUIElement`, the only way out. The
   * empty-image check above catches an icon that could not be read; it says
   * nothing about an item macOS placed somewhere the user cannot see — a menu
   * bar with no room left, or a third-party menu-bar manager that hides new
   * items by default. Without this the log is identical in both cases.
   */
  private reportPlacement(): void {
    const timer = setTimeout(() => {
      if (this.tray.isDestroyed()) return;

      const bounds = this.tray.getBounds();
      if (bounds.height > 0) {
        log("info", `tray placed at ${bounds.x},${bounds.y} ${bounds.width}×${bounds.height}`);
        return;
      }

      // `console.error` rather than `log`: mirrored into the log file *and*
      // visible under `pnpm dev`, because an app with no way in is worth
      // tripping over rather than reading about afterwards.
      console.error(
        "tray icon never reached the menu bar — the menu bar may be full, or a " +
          `menu-bar manager may be hiding it. Use ${toggleHint()} to record.`,
      );
    }, PLACEMENT_MS);

    // The timer must not be what keeps a quitting app alive: teardown runs on
    // `will-quit`, and a pending handle here would hold the process past it.
    timer.unref?.();
  }

  /**
   * Re-renders from the current session state.
   *
   * The tray subscribes to the session, but the session only emits on state
   * *transitions* — start, pause, stop. Elapsed time is not a transition, so
   * without something pushing this on a beat the menu-bar clock sits frozen at
   * the value it had when recording began.
   */
  refresh(): void {
    this.render(this.session.snapshot());
  }

  destroy(): void {
    this.tray.destroy();
  }

  private render(state: SessionState): void {
    const active = state.status === "recording" || state.status === "paused";
    this.tray.setImage(active ? this.recording : this.idle);

    // A running timer in the menu bar is the clearest signal that the app is
    // still capturing, which matters when every other window is hidden.
    this.tray.setTitle(active ? formatElapsed(state.elapsedMs) : "");
    this.tray.setToolTip(active ? `Prequel — ${state.status}` : "Prequel");
  }

  private contextMenu(): Menu {
    const state = this.session.snapshot();
    const active = state.status === "recording" || state.status === "paused";

    const recent = listProjects().slice(0, RECENT_LIMIT);

    return Menu.buildFromTemplate([
      active
        ? {
            label: "Stop Recording",
            accelerator: boundToggle() ?? undefined,
            // Through the flow rather than straight to the session: the flow is
            // what resets the panel and opens the editor, so stopping from here
            // would otherwise do noticeably less than stopping from the panel.
            click: () => void this.flow.stop(),
          }
        : {
            label: "Start Recording…",
            accelerator: boundToggle() ?? undefined,
            click: () => this.flow.open(),
          },
      {
        label: state.status === "paused" ? "Resume" : "Pause",
        enabled: active,
        click: () => void this.session.togglePause(),
      },
      { type: "separator" },
      // The whole library, with thumbnails and the things Open Recent cannot
      // offer — renaming one, deleting one, seeing what it is before opening it.
      { label: "Open Recordings", click: () => this.flow.openProjects() },
      {
        label: "Open Recent",
        enabled: recent.length > 0,
        submenu: recent.map((recording) => ({
          label: recording.name,
          click: () => this.flow.openEditor(recording.dir),
        })),
      },
      { label: "Show Recordings in Finder", click: () => void revealRecordings() },
      // The shared library, for the recordings that are not on this Mac. Only
      // once there is an account — an item that opens a sign-in page is a
      // promise the menu cannot keep.
      ...(authState().status === "signed-in"
        ? [{ label: "Open Shared Library", click: () => openDashboard() }]
        : []),
      // Reachable from the one menu that is always there, so a user can find
      // the log without being told where it lives.
      { label: "Show Log in Finder", click: () => shell.showItemInFolder(logPath()) },
      { type: "separator" },
      ...(authState().status === "signed-in"
        ? []
        : [{ label: "Sign In…", click: () => beginSignIn() }]),
      // What the app can say about its own version, from the one menu that is
      // always there. The menu is rebuilt on every right-click, so this reads
      // live state without anything having to push it.
      updateItem(this.flow),
      {
        label: "Settings…",
        accelerator: "Cmd+,",
        // Through the flow, like everything else here — the tray never reaches
        // for a window class directly.
        click: () => this.flow.openSettings(),
      },
      { type: "separator" },
      {
        label: "Quit Prequel",
        accelerator: "Cmd+Q",
        click: () => {
          // Logged because this is the only quit path a menu-bar app has: if
          // the app is still running after this, the log says the click landed
          // and the teardown is what failed.
          log("info", "quit requested from the tray");
          app.quit();
        },
      },
    ]);
  }
}

/**
 * The update entry, in whichever of its four states applies.
 *
 * One item rather than a conditional pair: an update is a thing with progress,
 * and a menu that showed "Check for Updates…" while one was downloading would
 * be offering to start the work it is already doing.
 *
 * Everything goes through the flow, like the rest of this menu — except
 * installing, which quits the app rather than opening a surface.
 */
function updateItem(flow: CaptureFlow): MenuItemConstructorOptions {
  const state = updateState();

  switch (state.status) {
    case "ready":
      return { label: "Restart to Update", click: () => installUpdate() };

    case "downloading":
      return { label: `Downloading… ${state.percent}%`, enabled: false };

    case "available":
      return { label: `Update to ${state.version}…`, click: () => flow.openUpdate() };

    default:
      return {
        label: "Check for Updates…",
        click: () => {
          // Opened first, not after: a check is a network round trip, and a menu
          // item that does nothing visible for a second reads as one that did
          // not register the click. The window shows the check running.
          flow.openUpdate();
          void checkForUpdates();
        },
      };
  }
}

/** `m:ss`, or `h:mm:ss` once it runs past an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
