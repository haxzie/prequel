/**
 * Settings.
 *
 * A menu-bar app has no app menu and no `⌘,` of its own, so this is reachable
 * only from the tray. That makes it the one place where everything the app
 * remembers is visible — including two capture settings that have been read on
 * every recording since the beginning and never had a control.
 *
 * A real `createWindow` rather than a panel: it takes focus, it is read and
 * clicked through, and it is not something that should float over a recording.
 * Fixed size, because the sidebar and the pane are drawn for one width.
 */
import type { BrowserWindow } from "electron";

import { createWindow, loadRoute } from "./base.js";

const WIDTH = 760;
const HEIGHT = 560;

export interface SettingsWindowOptions {
  onOpen?: () => void;
  onClose?: () => void;
  /**
   * Called when the window is focused.
   *
   * Open at login is owned by macOS, not by `preferences.json`, and the user
   * can change it in System Settings while this window sits open. The tray gets
   * away with reading it live because its menu is rebuilt on every right-click;
   * a window that stays open has to be told to look again.
   */
  onFocus?: () => void;
}

export class SettingsWindow {
  private window: BrowserWindow | null = null;

  constructor(private readonly options: SettingsWindowOptions = {}) {}

  get isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /** Opens it, or brings the one already open to the front. */
  open(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }

    const window = createWindow({
      width: WIDTH,
      height: HEIGHT,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "Prequel Settings",
      // The window ships its own dark surface; leaving this white flashes a
      // white rectangle before the first frame.
      backgroundColor: "#16171a",
    });

    this.window = window;

    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });

    window.on("focus", () => this.options.onFocus?.());

    window.on("closed", () => {
      this.window = null;
      this.options.onClose?.();
    });

    void loadRoute(window, "/settings");

    this.options.onOpen?.();
    return window;
  }

  close(): void {
    // `close`, not `destroy`: the `closed` handler is what puts the Dock icon
    // away again, and `destroy` skips it.
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }
}
