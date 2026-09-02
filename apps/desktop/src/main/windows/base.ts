/**
 * Shared window construction.
 *
 * Every window Prequel shows while recording has the same two requirements: it
 * must float above the app being recorded without stealing focus from it, and
 * it must be excludable from the capture itself.
 */
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, shell, type BrowserWindowConstructorOptions } from "electron";

// Resolved against the *bundle*, not this source file: electron-vite compiles
// every main-process module into a single `out/main/index.js`, so paths here
// are relative to `out/main/` however deeply the source is nested.
const PRELOAD = fileURLToPath(new URL("../preload/index.mjs", import.meta.url));
const RENDERER_HTML = fileURLToPath(new URL("../renderer/index.html", import.meta.url));

/**
 * A frameless, transparent, non-activating window.
 *
 * `type: "panel"` is the important flag: it makes the window an NSPanel, which
 * can receive clicks and drags *without activating Prequel*. Without it, every
 * click on the recording controls would pull focus away from the app the user
 * is recording — which would be visible in the recording.
 */
export function createPanel(options: BrowserWindowConstructorOptions = {}): BrowserWindow {
  // A vibrant panel is the other way round from a transparent one, on all three
  // of these.
  //
  // Transparency: `createWindow` explains it below and the same applies here —
  // Electron makes the web contents transparent itself when vibrancy is on, and
  // asking for both has a long history of painting the window opaque white. An
  // opaque `backgroundColor` would sit between the material and the contents
  // and hide it completely, which looks exactly like vibrancy not working.
  //
  // Shadow and corners: a CSS pill inside a larger transparent window has to
  // draw its own, because macOS would shape the window's to the rectangle. A
  // vibrant window has no such margin — the material fills the window, so the
  // window *is* the pill, and macOS shaping the corners and the shadow to it is
  // now the right answer rather than the wrong one. It is also the only answer:
  // the material sits behind the contents and cannot be clipped from CSS.
  const vibrant = options.vibrancy != null;

  const window = new BrowserWindow({
    show: false,
    frame: false,
    ...(vibrant
      ? { hasShadow: true, roundedCorners: true }
      : {
          transparent: true,
          // The window is a rectangle; the visible control is a pill or a circle
          // drawn inside it by CSS. macOS shapes both the shadow and the corner
          // mask to the *window*, so leaving these on draws a second, squarer
          // outline around the one the content draws. The renderer insets its
          // content by `PANEL_INSET` and casts its own shadow into that margin
          // instead.
          hasShadow: false,
          roundedCorners: false,
        }),
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // macOS-only. Non-activating panel: clickable without taking focus.
    type: "panel",
    ...options,
    // After `options`, not before, for the reason `createWindow` gives below:
    // an opaque colour here is composited over the material and the result is
    // indistinguishable from vibrancy being off.
    ...(vibrant ? { backgroundColor: "#00000000" } : {}),
    webPreferences: {
      preload: PRELOAD,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // A throttled renderer stops updating the elapsed timer the moment the
      // window loses focus, which is most of the time for a floating panel.
      backgroundThrottling: false,
      ...options.webPreferences,
    },
  });

  // Float above other apps, and follow the user across Spaces and into another
  // app's fullscreen Space. `skipTransformProcessType` avoids the dock-icon
  // flicker this call otherwise causes.
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

/**
 * An ordinary application window.
 *
 * Everything else Prequel shows is a non-activating `NSPanel`, because it has
 * to float over the app being recorded without stealing focus from it. The
 * editor is the opposite case: it is the thing the user is working in, so it
 * takes focus, resizes, and behaves like a document window. Sharing the panel
 * factory would make it unfocusable and unresizable.
 */
export function createWindow(options: BrowserWindowConstructorOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    // Room for the traffic lights without a full title bar: the editor draws
    // its own chrome, and a system title bar above it would be a second, empty
    // strip.
    titleBarStyle: "hiddenInset",
    ...options,
    // A vibrant window puts an `NSVisualEffectView` behind the web contents,
    // and an opaque `backgroundColor` sits between the two: the material is
    // built, composited under a solid rectangle, and never seen. Forced here
    // rather than trusted to the caller, because the result looks exactly like
    // a window with no vibrancy at all — which reads as the option not working
    // rather than as a background left switched on.
    //
    // `transparent: true` is deliberately not set alongside it. Electron makes
    // the web contents transparent itself when vibrancy is on, and asking for
    // both has a long history of painting the window opaque white instead.
    // Nothing may call `setBackgroundColor` on it afterwards either, for the
    // same reason the constructor value has to go.
    ...(options.vibrancy ? { backgroundColor: "#00000000" } : {}),
    webPreferences: {
      preload: PRELOAD,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      ...options.webPreferences,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

/**
 * Points a window at a renderer route.
 *
 * All windows share one HTML entry and route on the hash, so electron-vite's
 * dev server and HMR work the same for every one of them.
 */
export function loadRoute(window: BrowserWindow, route: string): Promise<void> {
  const devServer = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServer) {
    return window.loadURL(`${devServer}#${route}`);
  }
  return window.loadFile(RENDERER_HTML, { hash: route });
}

/**
 * The window's `CGWindowID`.
 *
 * Needed so ScreenCaptureKit can be told to leave our own UI out of the
 * recording. Electron's `setContentProtection(true)` sets `NSWindowSharingNone`,
 * which ScreenCaptureKit ignores on current macOS — passing the id into the
 * content filter is the only thing that actually works.
 *
 * `getMediaSourceId()` returns `"window:<CGWindowID>:0"`.
 */
export function windowId(window: BrowserWindow): number | null {
  const parsed = Number.parseInt(window.getMediaSourceId().split(":")[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}
