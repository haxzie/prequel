/**
 * The dock's drop-ups, as a window of their own.
 *
 * They used to be absolutely positioned inside the dock's window, which was
 * grown upward to make room for them. That is why they cannot stay there: the
 * dock is a vibrant window now, and a window gets exactly one
 * `NSVisualEffectView` filling exactly its own rectangle. A pill and a menu
 * floating above it are two shapes, so they are two windows — which is how
 * macOS does it too, an `NSMenu` being its own window.
 */
import { screen, type BrowserWindow } from "electron";

import {
  DOCK_MENU_GAP,
  DOCK_MENU_MARGIN,
  IPC_CHANNELS,
  type DockMenu,
} from "../../shared/contract.js";
import { createPanel, loadRoute } from "./base.js";

/**
 * What the window opens at, before the renderer has measured anything.
 *
 * Close to what a device list actually comes out as, so the first frame is not
 * visibly the wrong shape — the window is placed from its size, and a default
 * far from the truth reads as the menu jumping as it opens.
 */
const INITIAL = { width: 240, height: 120 };

export class DockMenuWindow {
  private window: BrowserWindow | null = null;
  /**
   * Whether the renderer has run.
   *
   * `prepare` creates the window and starts a load; `loadRoute` is
   * asynchronous. So the first menu of a launch is pushed to a webContents
   * that has not executed a line of the bundle yet, and showing the window at
   * that moment puts an empty frosted rectangle above the pill until the load
   * finishes. Tracked rather than read from `webContents.isLoading()`, which
   * is a question about the network stack and answers `false` in the gap
   * before a load has started.
   */
  private ready = false;
  private menu: DockMenu | null = null;
  private size = INITIAL;
  /** The dock window's frame, which is what a menu is positioned against. */
  private dock: { x: number; y: number } | null = null;

  /** Creates the window without showing it, so its id exists to be excluded. */
  prepare(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    const window = createPanel({ ...INITIAL, vibrancy: "hud" });
    // One level above the dock, which is itself one above the selection
    // overlays. Without this the menu opens *behind* the panel that owns it —
    // the two windows are siblings and nothing else decides the order.
    window.setAlwaysOnTop(true, "screen-saver", 2);
    this.ready = false;
    void loadRoute(window, "/dock-menu");
    // Re-sent on load, which is what restores the menu across an HMR round trip
    // rather than leaving an empty frosted rectangle on screen.
    window.webContents.on("did-finish-load", () => {
      this.ready = true;
      this.push();
      // A menu that was asked for while this was still loading. `open` left it
      // hidden precisely so it would not be seen empty; now there is something
      // in it, so it can be placed and shown.
      if (this.menu !== null && !window.isDestroyed()) {
        this.applyBounds();
        window.showInactive();
      }
    });

    this.window = window;
    return window;
  }

  /**
   * Opens a menu, or closes whatever is open.
   *
   * `dock` is the dock window's top-left corner. A menu is placed against the
   * panel that opened it rather than against the screen, so dragging the dock
   * is just this again with a new corner — and `menu.anchorX`, which is in the
   * dock window's own coordinates, stays valid across the move.
   */
  open(menu: DockMenu | null, dock: { x: number; y: number } | null): void {
    this.menu = menu;
    this.dock = dock;

    if (menu === null) {
      this.hide();
      return;
    }

    const window = this.prepare();
    this.push();
    this.applyBounds();

    // Not until the renderer has run. On the first open of a launch this
    // window was created a few lines ago and the push above reached nobody, so
    // showing here is what put an empty menu under the pointer — every time,
    // and only the first time, which is exactly how it reads as a glitch
    // rather than a state. `did-finish-load` shows it instead.
    if (!this.ready) return;

    // `showInactive`, as everywhere else in this app: a menu that takes focus
    // takes it from whatever the user is about to record.
    window.showInactive();
  }

  /**
   * The renderer has measured its content.
   *
   * Taken as given, and clamped only against the room there actually is above
   * the dock — see `applyBounds`. A fixed cap here is what made the permissions
   * panel scroll inside itself: it is prose, not a list, and it has no length
   * to be defended against.
   */
  setSize(size: { width: number; height: number }): void {
    this.size = { width: Math.round(size.width), height: Math.round(size.height) };
    if (this.menu !== null) this.applyBounds();
  }

  /** Follows the dock, which the user can drag while a menu is open. */
  follow(dock: { x: number; y: number }): void {
    this.dock = dock;
    if (this.menu !== null) this.applyBounds();
  }

  hide(): void {
    this.menu = null;
    // As in `DockWindow.hide`: `?.` does not cover a window Electron has
    // already destroyed, which is what a quit leaves behind.
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
  }

  get isOpen(): boolean {
    return this.menu !== null;
  }

  /** Which menu is open, for `DockState`. */
  get openKind(): DockMenu["kind"] | null {
    return this.menu?.kind ?? null;
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.menu = null;
    this.ready = false;
  }

  private push(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(IPC_CHANNELS.dockMenuContent, this.menu);
  }

  /**
   * Centres the menu on the control that opened it, above the dock.
   *
   * The clamp is what the two menu components used to do for themselves with a
   * `translateX` against `window.innerWidth` — the rightmost control's menu is
   * wider than the control, so centred it hangs over the edge. It is main's job
   * now, because the edge that matters is the screen's rather than the dock
   * window's.
   */
  private applyBounds(): void {
    const window = this.window;
    const dock = this.dock;
    const menu = this.menu;
    if (!window || window.isDestroyed() || !dock || !menu) return;

    const { workArea } = screen.getDisplayNearestPoint({ x: dock.x, y: dock.y });
    const { width } = this.size;

    // Only the screen limits how tall a menu may be. The renderer caps a device
    // list itself; everything else is as tall as it needs to be, and this is
    // the one thing it cannot be allowed to exceed.
    const room = dock.y - workArea.y - DOCK_MENU_GAP - DOCK_MENU_MARGIN;
    const height = Math.max(1, Math.min(this.size.height, room));

    // The control's centre in screen coordinates. `anchorX` is measured inside
    // the dock's window, which is the only frame the renderer can see.
    const centre = dock.x + menu.anchorX;
    const min = workArea.x + DOCK_MENU_MARGIN;
    const max = workArea.x + workArea.width - width - DOCK_MENU_MARGIN;

    window.setBounds({
      // `Math.max` outermost so a menu wider than the work area is pinned to
      // the left edge rather than pushed off the other side by the clamp.
      x: Math.round(Math.max(min, Math.min(centre - width / 2, max))),
      y: Math.round(dock.y - height - DOCK_MENU_GAP),
      width,
      height,
    });
  }
}
