/**
 * The bottom panel: setup before recording, controls during.
 *
 * One window that resizes rather than two that swap, so pressing Record reads
 * as the panel collapsing into the recording view — and so the window id stays
 * stable, which matters because that id is what keeps the panel out of the
 * recording.
 */
import { screen, type BrowserWindow, type Rectangle } from "electron";

import {
  DOCK_MENU_HEADROOM,
  PANEL_HEIGHT,
  PANEL_INSET,
  type DockView,
} from "../../shared/contract.js";
import { createPanel, loadRoute } from "./base.js";

/**
 * The size of the visible panel. The window is larger — see `windowSize`.
 *
 * Setup's width is only a starting point: the panel's real width depends on
 * the device names in it, which main has no way to measure, so the renderer
 * reports it and `setContentWidth` takes over.
 */
const SIZES: Record<DockView, { width: number; height: number }> = {
  setup: { width: 420, height: PANEL_HEIGHT },
  recording: { width: 196, height: PANEL_HEIGHT },
};

/**
 * Bounds on a reported width.
 *
 * A measurement taken mid-layout can be nonsense, and a window sized from it
 * would be a full-screen transparent sheet or a sliver — neither of which the
 * user could recover from without quitting.
 */
const MIN_SETUP_WIDTH = 260;
const MAX_SETUP_WIDTH = 900;

/** Distance from the bottom of the work area to the bottom of the panel. */
const BOTTOM_MARGIN = 72;

/**
 * How long the panel takes to collapse into the recording controls.
 *
 * Driven here rather than through `setBounds`'s `animate` flag, which AppKit
 * ignores for a transparent non-activating panel — measured, not assumed: the
 * width jumped from 411 to 232 between two consecutive frames with it on.
 */
const COLLAPSE_MS = 220;

/**
 * A width change is a smaller move than the collapse and reads as fussy if it
 * takes as long, so it gets its own, quicker easing.
 */
const RESIZE_MS = 150;
const FRAME_MS = 16;

export class DockWindow {
  private window: BrowserWindow | null = null;
  private view: DockView = "setup";
  private menuOpen = false;
  private animation: ReturnType<typeof setInterval> | null = null;
  /** The setup panel's measured width, once the renderer has reported one. */
  private contentWidth: number | null = null;

  /** Creates the window without showing it, so its id exists to be excluded. */
  prepare(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    const window = createPanel({ ...this.windowSize(), movable: true });
    // One layer above the selection overlays, which sit at `screen-saver` so
    // they can cover full-screen apps. Without the extra level the panel
    // disappears behind its own picker, and the camera and microphone cannot be
    // changed while choosing what to record — which is exactly when you look at
    // them.
    window.setAlwaysOnTop(true, "screen-saver", 1);
    void loadRoute(window, "/dock");

    this.window = window;
    return window;
  }

  show(): void {
    const window = this.prepare();
    // Only positioned on the way in. Re-running this on an already-visible
    // panel would yank it back to the centre of the screen after the user had
    // dragged it somewhere, and would fight the resize animation.
    if (!window.isVisible()) this.applyBounds(window);
    // `showInactive` rather than `show`: the panel must never take focus from
    // whatever the user is about to record.
    window.showInactive();
  }

  hide(): void {
    this.menuOpen = false;
    this.stopAnimation();
    // As in `CameraWindow.hide`: `?.` does not cover a window Electron has
    // already destroyed, which is what a quit leaves behind.
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
  }

  toggle(): void {
    if (this.window?.isVisible()) this.hide();
    else this.show();
  }

  get isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }

  /** Resizes the panel between its setup and recording shapes. */
  setView(view: DockView): void {
    if (this.view === view) return;
    this.view = view;
    // The recording view has no menus, and a stale headroom would leave an
    // invisible rectangle hanging over the screen.
    this.menuOpen = false;
    // Animated: pressing Record should read as the panel collapsing into the
    // recording controls, not as one window being swapped for another.
    this.reposition({ animate: true });
  }

  /**
   * Matches the window to the width the panel says it needs.
   *
   * Device names are the reason: sizing for the longest possible one leaves a
   * gap after every short one, and sizing for a short one clips the rest.
   */
  setContentWidth(width: number): void {
    const clamped = Math.round(Math.min(Math.max(width, MIN_SETUP_WIDTH), MAX_SETUP_WIDTH));
    if (this.contentWidth === clamped) return;

    // The first report replaces a guess made before anything was measured.
    // Animating that would show the panel stretching every time it opened.
    const measured = this.contentWidth !== null;
    this.contentWidth = clamped;

    if (this.view === "setup") this.reposition({ animate: measured, duration: RESIZE_MS });
  }

  /**
   * Grows the window upward so an open drop-up has somewhere to be drawn.
   *
   * Without this the menu is clipped to whatever fits inside the panel's own
   * height, which is a few pixels of its bottom edge.
   */
  setMenuOpen(open: boolean): void {
    if (this.menuOpen === open) return;
    this.menuOpen = open;
    this.reposition();
  }

  browserWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  destroy(): void {
    this.stopAnimation();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /**
   * Eases the window to `target`.
   *
   * The panel *is* the window, so animating its width means animating the
   * frame — there is no CSS route to this without leaving the window at its
   * larger size and a transparent dead area around the collapsed panel.
   */
  private animateTo(window: BrowserWindow, target: Rectangle, duration: number): void {
    this.stopAnimation();

    const from = window.getBounds();
    const started = Date.now();

    this.animation = setInterval(() => {
      if (window.isDestroyed()) return this.stopAnimation();

      const t = Math.min(1, (Date.now() - started) / duration);
      // Ease out: the collapse should decelerate into its resting size rather
      // than stop dead.
      const eased = 1 - (1 - t) ** 3;
      const at = (start: number, end: number) => Math.round(start + (end - start) * eased);

      window.setBounds({
        x: at(from.x, target.x),
        y: at(from.y, target.y),
        width: at(from.width, target.width),
        height: at(from.height, target.height),
      });

      if (t >= 1) this.stopAnimation();
    }, FRAME_MS);
  }

  private stopAnimation(): void {
    if (!this.animation) return;
    clearInterval(this.animation);
    this.animation = null;
  }

  /**
   * The window is the panel plus a transparent margin on every side, which is
   * where its CSS drop shadow lands — macOS would otherwise draw a rectangular
   * shadow around a rounded panel — plus headroom for an open drop-up.
   */
  private windowSize(): { width: number; height: number } {
    const { width, height } = SIZES[this.view];
    const panel = this.view === "setup" ? (this.contentWidth ?? width) : width;
    return {
      width: panel + PANEL_INSET * 2,
      height: height + PANEL_INSET * 2 + (this.menuOpen ? DOCK_MENU_HEADROOM : 0),
    };
  }

  private reposition(options: { animate?: boolean; duration?: number } = {}): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    // Menus are never animated: the drop-up is drawn into the headroom the
    // moment it opens, so the window has to be that size already.
    this.applyBounds(window, { keepPlace: true, ...options });
  }

  /**
   * Positions the panel, holding it in place when the window changes shape so
   * it does not appear to jump across the screen.
   */
  private applyBounds(
    window: BrowserWindow,
    options: { keepPlace?: boolean; animate?: boolean; duration?: number } = {},
  ): void {
    const size = this.windowSize();

    if (options.keepPlace && window.isVisible()) {
      const current = window.getBounds();
      const target = {
        x: Math.round(current.x + (current.width - size.width) / 2),
        // Held by the bottom edge, not the centre: the panel is drawn at the
        // bottom of the window, so the window can grow upward for a drop-up
        // without the panel itself moving.
        y: Math.round(current.y + current.height - size.height),
        ...size,
      };

      if (options.animate) this.animateTo(window, target, options.duration ?? COLLAPSE_MS);
      // Menus are never animated: the drop-up is drawn into the headroom the
      // moment it opens, so the window has to be that size already.
      else {
        this.stopAnimation();
        window.setBounds(target);
      }
      return;
    }

    this.stopAnimation();

    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    window.setBounds({
      x: Math.round(workArea.x + (workArea.width - size.width) / 2),
      // Measured to the panel, so neither the transparent margin nor the
      // drop-up headroom pushes it visibly up the screen.
      y: Math.round(workArea.y + workArea.height - size.height - BOTTOM_MARGIN + PANEL_INSET),
      ...size,
    });
  }
}
