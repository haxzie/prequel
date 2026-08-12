/**
 * The overlay used to pick a window or drag out an area.
 *
 * Only shown for the modes that need it — choosing "entire screen" needs no
 * overlay at all. One window per display, so it works the same on a laptop and
 * on a multi-monitor desk.
 */
import { BrowserWindow, screen, type Display } from "electron";

import type { PickerWindow, ScreenMode, SelectionResult, Target } from "../../shared/contract.js";
import { IPC_CHANNELS } from "../../shared/contract.js";
import { createPanel, loadRoute } from "./base.js";

/** One overlay and the display it covers. */
interface Pane {
  window: BrowserWindow;
  display: Display;
}

export class SelectionOverlay {
  private panes: Pane[] = [];
  private pending: ((result: SelectionResult | null) => void) | null = null;
  /** The mode currently on screen, so a refresh can re-describe it. */
  private mode: ScreenMode = "screen";

  get isOpen(): boolean {
    return this.panes.length > 0;
  }

  /**
   * Resolves with the chosen target, or `null` if the user cancelled.
   *
   * `icons` maps a `CGWindowID` to its app icon; missing entries simply render
   * without one.
   */
  open(
    mode: ScreenMode,
    targets: Target[],
    icons: Map<number, string> = new Map(),
  ): Promise<SelectionResult | null> {
    // Cancel rather than close: a second open leaves the first promise unsettled
    // otherwise, and whatever is awaiting it waits forever — which now matters,
    // because the panel sits above the overlay and its mode buttons stay live
    // while a picker is up.
    this.settle(null);

    this.mode = mode;

    return new Promise((resolve) => {
      this.pending = resolve;

      for (const display of screen.getAllDisplays()) {
        this.panes.push({ window: this.createFor(display, mode, targets, icons), display });
      }
      // Nowhere to draw would leave the promise hanging forever.
      if (this.panes.length === 0) this.settle(null);
    });
  }

  /**
   * Replaces what the overlays are showing.
   *
   * The window list is a snapshot taken before the overlay opened, and it goes
   * stale the moment anything moves: bring another window forward while the
   * picker is up and it is still described in its old position, or in its old
   * place in the stack. Pushing a fresh list keeps the picker honest about what
   * is actually on screen.
   */
  update(targets: Target[], icons: Map<number, string> = new Map()): void {
    for (const { window, display } of this.panes) {
      if (window.isDestroyed()) continue;
      window.webContents.send(
        IPC_CHANNELS.selectionSetup,
        describe(display, this.mode, targets, icons),
      );
    }
  }

  choose(result: SelectionResult): void {
    this.settle(result);
  }

  cancel(): void {
    this.settle(null);
  }

  close(): void {
    for (const { window } of this.panes) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.panes = [];
  }

  browserWindows(): BrowserWindow[] {
    return this.panes.map((pane) => pane.window);
  }

  private settle(result: SelectionResult | null): void {
    const resolve = this.pending;
    this.pending = null;
    this.close();
    resolve?.(result);
  }

  private createFor(
    display: Display,
    mode: ScreenMode,
    targets: Target[],
    icons: Map<number, string>,
  ): BrowserWindow {
    const window = createPanel({ ...display.bounds, alwaysOnTop: true });
    window.setAlwaysOnTop(true, "screen-saver");

    // Escape here rather than only in the overlay's own `keydown`. These are
    // `screen-saver`-level panels and there is one per display, so which of
    // them holds keyboard focus — if any does — is not something to depend on.
    // `before-input-event` fires on the window whatever the DOM is doing.
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") this.cancel();
    });
    window.setFullScreenable(false);

    void loadRoute(window, "/selection").then(() => {
      window.webContents.send(IPC_CHANNELS.selectionSetup, describe(display, mode, targets, icons));
      window.showInactive();
      // The overlay owns the keyboard while it is up, so Escape works without
      // the user having to click it first.
      window.focus();
    });

    return window;
  }
}

/**
 * One overlay's view of its display.
 *
 * Electron reports geometry in device-independent points with a global origin;
 * the renderer draws in CSS pixels local to its own window. Everything is
 * rebased here, so that conversion lives in exactly one place.
 */
function describe(
  display: Display,
  mode: ScreenMode,
  targets: Target[],
  icons: Map<number, string>,
) {
  const { bounds } = display;

  const windows: PickerWindow[] = targets
    .filter((target) => target.kind === "Window" && intersects(target.bounds, bounds))
    .map((target) => ({
      target,
      rect: {
        x: target.bounds.x - bounds.x,
        y: target.bounds.y - bounds.y,
        width: target.bounds.width,
        height: target.bounds.height,
      },
      ...(icons.has(target.id) ? { icon: icons.get(target.id) } : {}),
    }));

  return {
    mode,
    displayId: display.id,
    // The one thing that tells two screens apart on a multi-monitor desk; the
    // resolution often does not.
    displayLabel: display.label || `Display ${display.id}`,

    width: bounds.width,
    height: bounds.height,
    scaleFactor: display.scaleFactor,
    screenTarget: screenTargetFor(display),
    windows,
  };
}

/**
 * The "this whole screen" target, built from Electron's own display.
 *
 * Deliberately not looked up in ScreenCaptureKit's list: that list omits a
 * display entirely while it is asleep, and Electron already knows the id — which
 * *is* the `CGDirectDisplayID` on macOS — along with the bounds and scale.
 */
export function screenTargetFor(display: Display): Target {
  const { bounds } = display;
  const pixels = (value: number) => Math.round(value * display.scaleFactor);

  return {
    kind: "Display",
    id: display.id,
    title: `Display ${pixels(bounds.width)}×${pixels(bounds.height)}`,
    appName: "",
    appPath: "",
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    scaleFactor: display.scaleFactor,
  };
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
