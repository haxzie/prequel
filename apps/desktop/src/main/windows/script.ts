/**
 * The window the script is written in.
 *
 * A real `createWindow` rather than a panel: the island is a non-activating
 * panel and can never take the keyboard, so typing has to happen somewhere
 * that can. Like the update window it has to be registered with
 * `syncDockIcon`, or a menu-bar app with no Cmd-Tab entry loses it behind
 * whatever is being recorded. It is closed when recording starts for the
 * other reason a normal window is a liability here: it would be in the take.
 */
import type { BrowserWindow } from "electron";

import { createWindow, loadRoute } from "./base.js";

const WIDTH = 520;
const HEIGHT = 440;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 280;

export interface ScriptWindowOptions {
  onOpen?: () => void;
  onClose?: () => void;
}

export class ScriptWindow {
  private window: BrowserWindow | null = null;

  constructor(private readonly options: ScriptWindowOptions = {}) {}

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
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      maximizable: false,
      fullscreenable: false,
      title: "Teleprompter Script",
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

    void loadRoute(window, "/script");

    this.options.onOpen?.();
    return window;
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }
}
