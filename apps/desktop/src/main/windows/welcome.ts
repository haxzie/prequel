/**
 * The window the app opens on when it cannot yet do its job.
 *
 * Shown on a first run, and on any run where Screen Recording is still not
 * granted. The second condition is the one that earns it: without that
 * permission every part of the app is present and none of it works, and a
 * recorder that produces nothing is a much worse first impression than a
 * window asking for one thing.
 *
 * A real `createWindow` rather than a panel: this is something to be read and
 * clicked through, so it takes focus and behaves like a window. Fixed size —
 * there is nothing in it worth resizing, and a resizable onboarding window
 * invites the user to make it a shape the layout was never drawn for.
 */
import type { BrowserWindow } from "electron";

import { createWindow, loadRoute } from "./base.js";

const WIDTH = 720;
const HEIGHT = 520;

export interface WelcomeWindowOptions {
  onOpen?: () => void;
  onClose?: () => void;
}

export class WelcomeWindow {
  private window: BrowserWindow | null = null;

  constructor(private readonly options: WelcomeWindowOptions = {}) {}

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
      title: "Welcome to Prequel",
      // The window ships its own dark surface; leaving this white flashes a
      // white rectangle before the first frame.
      backgroundColor: "#16171a",
    });

    this.window = window;

    // Drawn before it appears, rather than as an empty rectangle that fills in.
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });

    window.on("closed", () => {
      this.window = null;
      this.options.onClose?.();
    });

    void loadRoute(window, "/welcome");

    this.options.onOpen?.();
    return window;
  }

  close(): void {
    // `close`, not `destroy`: the `closed` handler is what tells the app the
    // flow is over and puts the panel back, and `destroy` skips it.
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }
}
