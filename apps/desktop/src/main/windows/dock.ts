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
  DOCK_HEADROOM,
  PANEL_HEIGHT,
  PANEL_INSET,
  type DockMenu,
  type DockMenuPick,
  type DockView,
} from "../../shared/contract.js";
import { createPanel, loadRoute } from "./base.js";
import { DockMenuPopup } from "./dock-menu.js";

/**
 * The size of the visible panel. The window adds `PANEL_INSET` around it and
 * `DOCK_HEADROOM` above — see `windowSize`.
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

/**
 * How often the cursor is checked against the panel while the dock is showing.
 *
 * The window is bigger than the panel — `DOCK_HEADROOM` above it and
 * `PANEL_INSET` on the other three sides — and a transparent window still
 * takes every click over it. The band above the pill was a strip nothing
 * behind could be clicked through, with nothing drawn in it to say why. So the
 * window ignores the mouse except while the cursor is over the panel, and main
 * watches the cursor to say when — the way `CameraWindow` does for its bubble,
 * and for the same reason: the pill is a drag region, and a drag region gets
 * no mouse events for the renderer to decide this from.
 *
 * Quicker than the bubble's poll. That one reveals a button; this one decides
 * whether a click lands at all, and a cursor that crossed the edge and clicked
 * inside one tick would fall through to whatever is behind.
 */
const CURSOR_POLL_MS = 40;

export class DockWindow {
  private window: BrowserWindow | null = null;
  private view: DockView = "setup";
  private animation: ReturnType<typeof setInterval> | null = null;
  /** The setup panel's measured width, once the renderer has reported one. */
  private contentWidth: number | null = null;
  private cursorTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether the window is currently letting the mouse through to what is behind. */
  private passthrough = true;
  /**
   * The drop-ups, which are native menus popped over this window.
   *
   * Owned here rather than beside this one in `capture-flow`, because every
   * event that has to close a menu — hiding, collapsing to the recording view
   * — arrives at the dock.
   */
  readonly menu = new DockMenuPopup();

  /** Creates the window without showing it, so its id exists to be excluded. */
  prepare(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    // Transparent rather than vibrant, and the pill is drawn in CSS.
    //
    // The material was the whole reason macOS shaped this window: it sits
    // behind the web contents and cannot be clipped from CSS, so the window had
    // to *be* the pill and take the system's corner radius with it. Electron
    // exposes `roundedCorners` as a boolean and nothing else, so on a 44pt bar
    // that radius was not a choice — it read as a full pill.
    //
    // Drawing it here costs the frost and buys the radius. It also brings back
    // the transparent margin `PANEL_INSET` is for: macOS shapes a window's
    // shadow to its rectangle, so a shadow on a square window around a rounded
    // panel would be a square. `CameraWindow` has always worked this way.
    const window = createPanel({ ...this.windowSize(), movable: true });
    // One layer above the selection overlays, which sit at `screen-saver` so
    // they can cover full-screen apps. Without the extra level the panel
    // disappears behind its own picker, and the camera and microphone cannot be
    // changed while choosing what to record — which is exactly when you look at
    // them.
    window.setAlwaysOnTop(true, "screen-saver", 1);
    // Click-through until the cursor is known to be over the panel — see
    // `watchCursor`. Set here as well as there so the state matches
    // `passthrough` from the first frame rather than from the first tick.
    window.setIgnoreMouseEvents(true);
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
    this.watchCursor(window);
  }

  hide(): void {
    this.menu.close();
    this.stopAnimation();
    this.stopWatchingCursor();
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
    // The recording view has none of the controls a menu belongs to, so a menu
    // left open would be a list floating over the screen with nothing
    // underneath it.
    this.menu.close();
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
   * Opens a drop-up above the panel, resolving with what was picked in it.
   *
   * The menu is native and this window is what it is popped from, so the
   * anchor stays in this window's coordinates: `getBoundingClientRect` in the
   * renderer already measures relative to it, inset and headroom included, and
   * `Menu.popup` takes exactly that.
   */
  openMenu(menu: DockMenu): Promise<DockMenuPick | null> {
    const window = this.browserWindow();
    if (!window) return Promise.resolve(null);
    return this.menu.open(menu, window);
  }

  browserWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  destroy(): void {
    this.stopAnimation();
    this.stopWatchingCursor();
    this.menu.close();
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
   * Lets the mouse through the window except where the panel is.
   *
   * Checked once on the way in and then on every tick, so a dock that opens
   * under the cursor is clickable at once rather than a tick later.
   */
  private watchCursor(window: BrowserWindow): void {
    if (this.cursorTimer) return;

    const track = () => {
      if (window.isDestroyed() || !window.isVisible()) {
        this.stopWatchingCursor();
        return;
      }
      const passthrough = !overPanel(window.getBounds(), screen.getCursorScreenPoint());
      if (passthrough === this.passthrough) return;
      this.passthrough = passthrough;
      window.setIgnoreMouseEvents(passthrough);
    };

    track();
    this.cursorTimer = setInterval(track, CURSOR_POLL_MS);
  }

  private stopWatchingCursor(): void {
    if (!this.cursorTimer) return;
    clearInterval(this.cursorTimer);
    this.cursorTimer = null;
    // Back to click-through while hidden, so the next `show` starts from the
    // state `prepare` established rather than from wherever the cursor last
    // was.
    if (!this.passthrough && this.window && !this.window.isDestroyed()) {
      this.window.setIgnoreMouseEvents(true);
    }
    this.passthrough = true;
  }

  /**
   * The window is exactly the panel.
   *
   * It used to be the panel plus a transparent margin for its CSS drop shadow
   * and headroom for an open drop-up. A vibrant window could afford neither:
   * the material fills the window's rectangle, so any part of the window the
   * panel did not cover was frosted desktop hanging in mid-air.
   *
   * The margin is back, because the panel is drawn in CSS again. The drop-ups
   * are native menus, so none of it is for them — but the top is
   * `DOCK_HEADROOM` rather than the inset, because the tooltips are drawn in
   * this window and above the panel, and the inset alone clips them. The
   * `Dock` component insets the panel by the same two numbers.
   */
  private windowSize(): { width: number; height: number } {
    const { width, height } = SIZES[this.view];
    const panel = this.view === "setup" ? (this.contentWidth ?? width) : width;
    return { width: panel + PANEL_INSET * 2, height: height + DOCK_HEADROOM + PANEL_INSET };
  }

  private reposition(options: { animate?: boolean; duration?: number } = {}): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
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
        // bottom of the window, under the headroom, so a change of height
        // must not move the panel itself.
        y: Math.round(current.y + current.height - size.height),
        ...size,
      };

      if (options.animate) this.animateTo(window, target, options.duration ?? COLLAPSE_MS);
      // The first measured width is not animated — see `setContentWidth` —
      // and a resize that is not eased has to land at once.
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
      // `+ PANEL_INSET` because `BOTTOM_MARGIN` is measured to the bottom of the
      // *panel*, and the window now extends that much further down. Without it
      // the dock would sit an inset closer to the edge than it used to.
      y: Math.round(workArea.y + workArea.height - size.height - BOTTOM_MARGIN + PANEL_INSET),
      ...size,
    });
  }
}

/**
 * Whether a point is over the panel, not merely the window.
 *
 * The panel sits at the bottom of the window under `DOCK_HEADROOM` of
 * transparent band, with `PANEL_INSET` of transparent margin on its other
 * three sides. Both are for what is drawn *around* the pill — tooltips above
 * it and its shadow — and neither should take a click meant for the app behind.
 * The `Dock` component insets the pill by the same two numbers, which is what
 * makes this rectangle the one on screen.
 */
export function overPanel(bounds: Rectangle, point: { x: number; y: number }): boolean {
  return (
    point.x >= bounds.x + PANEL_INSET &&
    point.x < bounds.x + bounds.width - PANEL_INSET &&
    point.y >= bounds.y + DOCK_HEADROOM &&
    point.y < bounds.y + bounds.height - PANEL_INSET
  );
}
