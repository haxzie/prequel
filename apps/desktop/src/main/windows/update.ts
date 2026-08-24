/**
 * The window that offers a newer version.
 *
 * A real `createWindow` rather than a panel, for the same reason as the welcome
 * window: this is something to be read and decided on, and the dock panel is 44
 * points tall with a recording control in it. It also has to be reachable — a
 * menu-bar app has no Dock icon and no Cmd-Tab entry, so anything focusable has
 * to be registered with `syncDockIcon` or it can be lost behind another app with
 * no way back to it.
 *
 * Fixed size: the release notes scroll inside it, and there is nothing else here
 * worth resizing.
 */
import type { BrowserWindow } from "electron";

import { createWindow, loadRoute } from "./base.js";

const WIDTH = 460;
const HEIGHT = 440;

export interface UpdateWindowOptions {
  onOpen?: () => void;
  onClose?: () => void;
}

export class UpdateWindow {
  private window: BrowserWindow | null = null;

  constructor(private readonly options: UpdateWindowOptions = {}) {}

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
      title: "Update Prequel",
      // The window ships its own dark surface; leaving this white flashes a
      // white rectangle before the first frame.
      backgroundColor: "#16171a",
    });

    this.window = window;

    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });

    window.on("closed", () => {
      this.window = null;
      this.options.onClose?.();
    });

    void loadRoute(window, "/update");

    this.options.onOpen?.();
    return window;
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }
}
