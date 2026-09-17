/**
 * The island: the script, hung from the top of the screen beside the camera.
 *
 * A prompter is only any use where the lens is, and on a MacBook that is the
 * notch. So the island lives on the built-in display, flush with its top
 * edge, drawn as the notch grown wide — and on a display with no notch, a
 * rounded panel just under the menu bar, in the same place relative to the
 * camera. It never appears in a recording: like the dock and the camera
 * bubble, its window id is handed to ScreenCaptureKit to leave out, which is
 * why `prepare` exists separately from `show`.
 */
import { screen, type BrowserWindow, type Display, type Rectangle } from "electron";

import {
  PANEL_INSET,
  TELEPROMPTER_TOP_GAP,
  TELEPROMPTER_WIDTHS,
  teleprompterHeight,
  type TeleprompterSize,
  type TeleprompterWidth,
} from "../../shared/contract.js";
import type { DisplaySafeArea } from "../recorder.js";
import { createPanel, loadRoute } from "./base.js";
import { watchCursor } from "./cursor.js";

/** The notch the island is drawn around, in points. */
export interface Notch {
  /** Height of the menu bar on that display, which the notch spans. */
  height: number;
  width: number;
}

/**
 * What a notch is assumed to look like when AppKit will not say.
 *
 * `displaySafeArea` answers on every display AppKit knows; this is for the
 * fake recorder and for the day the lookup fails. A built-in display whose
 * menu bar is taller than the classic 24 points has a notch — every notched
 * MacBook draws it at 32 or more — and the width is the 14-inch model's.
 */
const CLASSIC_MENU_BAR = 30;
const ASSUMED_NOTCH_WIDTH = 200;

export interface TeleprompterWindowOptions {
  /** `Recorder.displaySafeArea`, injected so the window can be tested without the addon. */
  safeArea: (displayId: number) => DisplaySafeArea | null;
}

export class TeleprompterWindow {
  private window: BrowserWindow | null = null;
  private size: TeleprompterSize = "medium";
  private width: TeleprompterWidth = "normal";
  /** The notch the island was last laid out around; null for a plain top edge. */
  private notch: Notch | null = null;
  private stopWatchingCursor: (() => void) | null = null;

  constructor(private readonly options: TeleprompterWindowOptions) {}

  /** Creates the window without showing it, so its id exists to be excluded. */
  prepare(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    // Created at its final place rather than moved there. AppKit is allowed
    // to push a window it considers badly placed back under the menu bar when
    // it is moved, and a panel that is *born* over the menu bar — as the
    // selection overlays are — is left alone.
    const window = createPanel(this.bounds());
    // Above the selection overlays, as the dock is: choosing what to record
    // is exactly when the script is worth a glance.
    window.setAlwaysOnTop(true, "screen-saver", 1);
    // Click-through until the cursor is known to be over the island — see
    // `watchCursor`. Set here so the first frame matches rather than the
    // first tick.
    window.setIgnoreMouseEvents(true);
    void loadRoute(window, "/teleprompter");

    this.window = window;
    return window;
  }

  /** Shows the island, and says what notch it is drawn around. */
  show(): Notch | null {
    const window = this.prepare();
    // Re-placed on every show: the built-in display may have been closed or
    // opened since, and there is no user position to preserve.
    window.setBounds(this.bounds());
    // `showInactive`: the island must never take focus from what is being recorded.
    window.showInactive();
    this.stopWatchingCursor ??= watchCursor(window, (bounds, point) =>
      this.overIsland(bounds, point),
    );
    return this.notch;
  }

  hide(): void {
    this.stopWatchingCursor?.();
    this.stopWatchingCursor = null;
    // `?.` covers "never opened", not "already destroyed", which a quit leaves.
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
  }

  get isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /** Re-lays the island out for a new text size or width. */
  setShape(size: TeleprompterSize, width: TeleprompterWidth): void {
    if (this.size === size && this.width === width) return;
    this.size = size;
    this.width = width;
    if (this.isVisible) this.window!.setBounds(this.bounds());
  }

  browserWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  destroy(): void {
    this.stopWatchingCursor?.();
    this.stopWatchingCursor = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /**
   * Where the island goes, and how big it is.
   *
   * Also decides `notch`, since both depend on the same display. The window
   * carries `PANEL_INSET` of transparent margin for the CSS shadow on the
   * sides and the bottom; on a notch display the top is flush with the screen
   * edge, because the island is meant to read as part of the bezel.
   */
  private bounds(): Rectangle {
    const display = this.display();
    this.notch = this.notchOf(display);

    const width = TELEPROMPTER_WIDTHS[this.width] + PANEL_INSET * 2;
    const island = teleprompterHeight(this.size, this.notch?.height ?? 0);
    const top = this.notch ? 0 : PANEL_INSET;

    return {
      x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
      y: this.notch
        ? display.bounds.y
        : display.workArea.y + TELEPROMPTER_TOP_GAP - PANEL_INSET,
      width,
      height: island + top + PANEL_INSET,
    };
  }

  /**
   * The display with the camera: the built-in one when the lid is open,
   * otherwise the one the cursor is on. A closed MacBook drops its display
   * from the list, so an external webcam on a desk setup gets the same
   * top-centre placement on whatever the user is looking at.
   */
  private display(): Display {
    return (
      screen.getAllDisplays().find((display) => display.internal) ??
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    );
  }

  private notchOf(display: Display): Notch | null {
    const area = this.options.safeArea(display.id);
    if (area) {
      const { notchLeft, notchRight } = area;
      if (area.top <= 0 || notchLeft == null || notchRight == null) return null;
      return { height: area.top, width: notchRight - notchLeft };
    }

    if (!display.internal) return null;
    const menuBar = display.workArea.y - display.bounds.y;
    return menuBar > CLASSIC_MENU_BAR ? { height: menuBar, width: ASSUMED_NOTCH_WIDTH } : null;
  }

  /** Whether a point is over the island, not merely the window. */
  private overIsland(bounds: Rectangle, point: { x: number; y: number }): boolean {
    const top = this.notch ? 0 : PANEL_INSET;
    return (
      point.x >= bounds.x + PANEL_INSET &&
      point.x < bounds.x + bounds.width - PANEL_INSET &&
      point.y >= bounds.y + top &&
      point.y < bounds.y + bounds.height - PANEL_INSET
    );
  }
}
