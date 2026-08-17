/**
 * The floating camera bubble.
 *
 * Deliberately a preview only. The camera is recorded as its own track rather
 * than composited into the screen capture, which is what lets it be moved,
 * resized and reshaped after the recording — and it also means this window
 * never needs to appear in the capture at all.
 */
import { screen, type BrowserWindow } from "electron";

import { PANEL_INSET } from "../../shared/contract.js";
import { createPanel, loadRoute } from "./base.js";

/** Diameter of the visible circle. The window adds `PANEL_INSET` all round. */
const SIZES = { small: 160, medium: 220, large: 300 } as const;

export type CameraSize = keyof typeof SIZES;

/** Distance from the corner of the work area to the circle. */
const MARGIN = 32;

/** Window edge for a bubble size: the circle plus its shadow margin. */
function windowEdge(size: CameraSize): number {
  return SIZES[size] + PANEL_INSET * 2;
}

/**
 * How much of the bubble has to be on a display for a stored position to be
 * reused.
 *
 * A position saved on a monitor that has since been unplugged would otherwise
 * restore the bubble somewhere unreachable, with no way to drag it back.
 */
const MIN_VISIBLE = 60;

export class CameraWindow {
  private window: BrowserWindow | null = null;
  private size: CameraSize = "medium";
  /** Centre of the circle, as last left by the user. */
  private position: { x: number; y: number } | null = null;
  private listener: ((position: { x: number; y: number }) => void) | null = null;

  /**
   * Restores a remembered position.
   *
   * The centre rather than a corner, because resizing the bubble grows it from
   * the middle — a stored corner would drift every time the size changed.
   */
  restore(position: { x: number; y: number } | null): void {
    this.position = position;
  }

  /** Reports where the user left the bubble, so it can be remembered. */
  onMove(listener: (position: { x: number; y: number }) => void): void {
    this.listener = listener;
  }

  /** Creates the window without showing it, so its id exists to be excluded. */
  prepare(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    // `createPanel` already turns off the window's own shadow and corner
    // rounding, which is what keeps a square frame from showing around the
    // circle.
    const edge = windowEdge(this.size);
    const window = createPanel({ width: edge, height: edge, movable: true });

    // `moved` rather than `move`: macOS fires it once the drag is finished, so
    // this is not writing preferences on every frame of a drag.
    window.on("moved", () => {
      const bounds = window.getBounds();
      this.position = {
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      };
      this.listener?.(this.position);
    });

    window.setAlwaysOnTop(true, "floating");
    void loadRoute(window, "/camera");

    this.window = window;
    return window;
  }

  show(): void {
    const window = this.prepare();
    if (!window.isVisible()) window.setBounds(this.openingBounds());
    // `showInactive`: presenting the bubble must not take focus from whatever
    // the user is recording.
    window.showInactive();
  }

  hide(): void {
    // `?.` covers "never opened", not "already destroyed", and a quit leaves
    // exactly the second: Electron destroys the window while this still holds
    // the reference, and calling anything on it then throws.
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
  }

  setSize(size: CameraSize): void {
    if (this.size === size) return;
    this.size = size;

    const window = this.window;
    if (!window || window.isDestroyed()) return;

    // Grow from the centre so the bubble stays where the user put it.
    const current = window.getBounds();
    const edge = windowEdge(size);
    window.setBounds({
      x: Math.round(current.x + (current.width - edge) / 2),
      y: Math.round(current.y + (current.height - edge) / 2),
      width: edge,
      height: edge,
    });
  }

  browserWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /** Where the user left it, or the default corner if that is no longer sane. */
  private openingBounds() {
    const remembered = this.position && this.boundsAround(this.position);
    return remembered && onScreen(remembered) ? remembered : this.defaultBounds();
  }

  /** The window that puts the circle's centre at `centre`. */
  private boundsAround(centre: { x: number; y: number }) {
    const edge = windowEdge(this.size);
    return {
      x: Math.round(centre.x - edge / 2),
      y: Math.round(centre.y - edge / 2),
      width: edge,
      height: edge,
    };
  }

  /** Bottom-left of the display holding the cursor, clear of the panel. */
  private defaultBounds() {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const edge = windowEdge(this.size);

    return {
      // `MARGIN` is measured to the circle, so the transparent shadow margin
      // is subtracted back out and the bubble sits where it looks like it does.
      x: Math.round(workArea.x + MARGIN - PANEL_INSET),
      y: Math.round(workArea.y + workArea.height - edge - MARGIN + PANEL_INSET),
      width: edge,
      height: edge,
    };
  }
}

/** Whether enough of a window falls on some display to be usable. */
function onScreen(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);
    return overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE;
  });
}
