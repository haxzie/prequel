/**
 * Editor windows, one per recording.
 *
 * Keyed by directory rather than counted, because the same recording can be
 * reached from two places — stopping a take, and Open Recent — and opening a
 * second window onto one set of files would mean two editors writing the same
 * `project.json`.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { BrowserWindow } from "electron";

import { IPC_CHANNELS } from "../../shared/contract.js";
import { MANIFEST_FILE_NAME, parseManifest } from "../../shared/manifest.js";
import { flushProject } from "../editor-project.js";
import { mirrorConsole } from "../log.js";
import { readEditorSession } from "../editor-session.js";
import { createWindow, loadRoute } from "./base.js";

const MIN_WIDTH = 960;
const MIN_HEIGHT = 640;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 820;

export interface EditorWindowsOptions {
  /** The first editor opened. The recorder's floating UI gets out of the way. */
  onFirstOpen?: () => void;
  /** The last editor closed. The panel comes back. */
  onLastClose?: () => void;
}

export class EditorWindows {
  private readonly windows = new Map<string, BrowserWindow>();

  constructor(private readonly options: EditorWindowsOptions = {}) {}

  get openCount(): number {
    return this.windows.size;
  }

  /**
   * Opens a recording, or focuses the window already showing it.
   *
   * The manifest is read before anything is created: a directory with no
   * readable `session.json` is not editable, and an empty window that says so
   * would be worse than the error the caller can report. The full session —
   * which also probes the media — is loaded afterwards, so the window can be up
   * and drawing while that happens.
   */
  open(dir: string): BrowserWindow {
    const existing = this.windows.get(dir);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return existing;
    }

    const name = readManifestName(dir);
    const first = this.windows.size === 0;

    const window = createWindow({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: name,
      // The editor is a dark-surfaced tool and the window ships its own
      // background; leaving this white flashes a white rectangle on open.
      backgroundColor: "#16171a",
    });

    this.windows.set(dir, window);

    // Pushed on load rather than encoded into the route: the hash has to
    // survive a reload and an HMR round trip, and a serialised manifest in it
    // would not. Re-sent on every load for the same reason.
    // A packaged build has no devtools, so an error in the editor's own
    // process would otherwise go nowhere at all.
    mirrorConsole(window.webContents);

    window.webContents.on("did-finish-load", () => {
      void readEditorSession(dir)
        .then((session) => {
          if (window.isDestroyed()) return;
          window.webContents.send(IPC_CHANNELS.editorOpen, session);
        })
        .catch((cause) => {
          console.warn(`[editor] could not load ${dir}:`, cause);
        });
    });

    // `ready-to-show` rather than showing immediately, so the window appears
    // with its first frame drawn instead of as an empty rectangle.
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });

    window.on("closed", () => {
      this.windows.delete(dir);
      // Synchronous, and before anything else: the renderer's last debounced
      // save may still be in flight, and an editor is closed by closing its
      // window rather than by anything that waits for a promise.
      flushProject(dir);
      if (this.windows.size === 0) this.options.onLastClose?.();
    });

    void loadRoute(window, "/editor");

    if (first) this.options.onFirstOpen?.();
    return window;
  }

  closeAll(): void {
    // Copied first: `closed` mutates the map as it fires.
    for (const window of [...this.windows.values()]) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.windows.clear();
  }
}

/**
 * Checks a directory is an openable recording, and names it.
 *
 * Deliberately cheap and synchronous: it runs before the window exists so that
 * an unopenable directory throws at the call site rather than producing a
 * window with nothing in it.
 */
function readManifestName(dir: string): string {
  parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
  return basename(dir);
}
