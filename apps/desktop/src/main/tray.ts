/**
 * The menu-bar presence: icon, click-to-open panel, and right-click menu.
 */
import { fileURLToPath } from "node:url";

import { app, Menu, nativeImage, shell, Tray } from "electron";

import type { CaptureFlow } from "./capture-flow.js";
import { log, logPath } from "./log.js";
import type { RecordingSession, SessionState } from "./session.js";
import { recentRecordings, revealRecordings } from "./session.js";

/** How many past recordings the Open Recent submenu offers. */
const RECENT_LIMIT = 10;

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

    const recent = recentRecordings(RECENT_LIMIT);

    return Menu.buildFromTemplate([
      active
        ? {
            label: "Stop Recording",
            accelerator: "Shift+Cmd+R",
            // Through the flow rather than straight to the session: the flow is
            // what resets the panel and opens the editor, so stopping from here
            // would otherwise do noticeably less than stopping from the panel.
            click: () => void this.flow.stop(),
          }
        : {
            label: "Start Recording…",
            accelerator: "Shift+Cmd+R",
            click: () => this.flow.open(),
          },
      {
        label: state.status === "paused" ? "Resume" : "Pause",
        enabled: active,
        click: () => void this.session.togglePause(),
      },
      { type: "separator" },
      {
        label: "Open Recent",
        enabled: recent.length > 0,
        submenu: recent.map((recording) => ({
          label: recording.name,
          click: () => this.flow.openEditor(recording.dir),
        })),
      },
      { label: "Show Recordings in Finder", click: () => void revealRecordings() },
      // Reachable from the one menu that is always there, so a user can find
      // the log without being told where it lives.
      { label: "Show Log in Finder", click: () => shell.showItemInFolder(logPath()) },
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
