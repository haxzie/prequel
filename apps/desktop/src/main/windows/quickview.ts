/**
 * The quick view: what you get the moment a capture is finished.
 *
 * A floating card showing the take or the shot, with the three things anybody
 * wants from one straight away — export it, copy it, open it properly. It is
 * what a finished capture lands in now; the editor opens from a button on it
 * rather than by itself, because most captures are sent somewhere and never
 * edited at all, and a 784 KB editor window over the screen somebody has just
 * recorded is the app taking the machine back off them.
 *
 * A panel for the same reasons the dock is one: it must float above whatever
 * is on screen without taking focus from it, and it has to be excludable from
 * a capture — a quick view left up from the last take would otherwise be in
 * the next one.
 */
import { screen, type BrowserWindow, type Rectangle } from "electron";

import {
  IPC_CHANNELS,
  QUICK_VIEW_HEIGHT,
  QUICK_VIEW_MARGIN,
  QUICK_VIEW_WIDTH,
  type QuickViewCapture,
} from "../../shared/contract.js";
import { createPanel, loadRoute, pinZoom } from "./base.js";
import { watchCursor } from "./cursor.js";

/** Distance from the corner of the work area to the card. */
const MARGIN = 24;

export class QuickViewWindow {
  private window: BrowserWindow | null = null;
  private capture: QuickViewCapture | null = null;
  private stopWatchingCursor: (() => void) | null = null;

  /** What is on screen, for the renderer to ask for on mount. */
  current(): QuickViewCapture | null {
    return this.capture;
  }

  /** Creates the window without showing it, so its id exists to be excluded. */
  prepare(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    const window = createPanel({
      width: QUICK_VIEW_WIDTH + QUICK_VIEW_MARGIN * 2,
      height: QUICK_VIEW_HEIGHT + QUICK_VIEW_MARGIN * 2,
      movable: true,
    });
    // Above the pickers, as the dock is: the quick view and the panel are both
    // on screen while somebody decides what to do with the capture they just
    // made, and a card that vanished behind an overlay would read as dismissed.
    window.setAlwaysOnTop(true, "screen-saver", 1);
    // Click-through until the cursor is over the card — the margin is there
    // for the shadow, and a transparent window still takes every click over it.
    window.setIgnoreMouseEvents(true);
    void loadRoute(window, "/quickview");

    this.window = window;
    return window;
  }

  /** Shows the card on one capture, replacing whatever it was showing. */
  show(capture: QuickViewCapture): void {
    this.capture = capture;

    const window = this.prepare();
    // The card outlives nothing, but it loads the same `index.html` every other
    // window does — so a stray ctrl-scroll anywhere in the app would draw it at
    // the wrong size. See `lockZoom`.
    pinZoom();
    window.webContents.send(IPC_CHANNELS.quickViewChanged, capture);
    this.place(window);
    // Never `show`: the quick view must not take focus from whatever the user
    // went back to the moment the recording stopped.
    window.showInactive();
    this.stopWatchingCursor ??= watchCursor(window, overCard);
  }

  /** Dismisses it, and forgets what it was showing. */
  hide(): void {
    this.capture = null;
    this.stopWatchingCursor?.();
    this.stopWatchingCursor = null;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
    // Told as well as hidden, so the view resets rather than coming back on the
    // next capture still showing the last one's "Exported!".
    this.window.webContents.send(IPC_CHANNELS.quickViewChanged, null);
  }

  /** The window itself, for the capture's exclusion list. */
  browserWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  destroy(): void {
    this.stopWatchingCursor?.();
    this.stopWatchingCursor = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.capture = null;
  }

  /**
   * Bottom right of whichever display the cursor is on.
   *
   * Only on the way in, like the dock: a card dragged somewhere else stays
   * there for as long as it is up, and the next capture puts a fresh one back
   * in the corner.
   */
  private place(window: BrowserWindow): void {
    if (window.isVisible()) return;

    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = window.getBounds();
    window.setBounds({
      x: Math.round(workArea.x + workArea.width - bounds.width - MARGIN + QUICK_VIEW_MARGIN),
      y: Math.round(workArea.y + workArea.height - bounds.height - MARGIN + QUICK_VIEW_MARGIN),
      width: bounds.width,
      height: bounds.height,
    });
  }
}

/**
 * Whether a point is over the card rather than merely over the window.
 *
 * The window is `QUICK_VIEW_MARGIN` larger all round, which is the margin the
 * card's shadow is cast into. The `QuickView` component insets itself by the
 * same number, so this rectangle is the one on screen.
 */
export function overCard(bounds: Rectangle, point: { x: number; y: number }): boolean {
  return (
    point.x >= bounds.x + QUICK_VIEW_MARGIN &&
    point.x < bounds.x + bounds.width - QUICK_VIEW_MARGIN &&
    point.y >= bounds.y + QUICK_VIEW_MARGIN &&
    point.y < bounds.y + bounds.height - QUICK_VIEW_MARGIN
  );
}
