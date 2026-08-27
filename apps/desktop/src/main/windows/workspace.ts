/**
 * The app window: the Projects grid, and the editor for one recording.
 *
 * One window, not one per recording. Two editors over the same directory would
 * both write its `project.json`, and the grid has to be somewhere — making it a
 * second window would mean the same recording could be open in an editor while
 * being renamed or deleted from a list beside it.
 *
 * That singleton is load-bearing rather than incidental. `editor-project.ts`
 * holds an unwritten project in memory until `flushProject` puts it on disk, so
 * **being on the grid means nothing is pending**: every path that leaves an
 * editor flushes on the way out, and `projects.ts` can then rename a
 * `project.json` with no live editor to race. Add a path out of the editor that
 * skips the flush and a rename silently loses the last edit before it.
 *
 * The screen on show is pushed, never encoded in the route. The hash has to
 * survive a reload and an HMR round trip and a serialised manifest in it would
 * not — so the window always loads `/workspace`, and `did-finish-load` re-sends
 * whichever recording was open.
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

/** What the window is called while it is showing the grid. */
const GRID_TITLE = "Prequel";

export interface WorkspaceWindowOptions {
  /** The window opened. The recorder's floating UI gets out of the way. */
  onOpen?: () => void;
  /**
   * The window closed.
   *
   * `fromCapture` is true when it was opened by a finished take, which is the
   * only case where closing it should bring the recording panel back: somebody
   * who opened the grid from the tray to look through it did not ask for a
   * picker over the screen they were looking at.
   */
  onClose?: (fromCapture: boolean) => void;
}

export class WorkspaceWindow {
  private window: BrowserWindow | null = null;
  /** The recording the editor is showing, or null on the Projects grid. */
  private current: string | null = null;
  private fromCapture = false;

  constructor(private readonly options: WorkspaceWindowOptions = {}) {}

  get isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /** The recording being edited, or null when the grid is showing. */
  get currentDir(): string | null {
    return this.current;
  }

  /**
   * Opens the window, or brings the one already open to the front.
   *
   * With a directory it lands on that recording's editor; without one it lands
   * on the grid. Either way an already-open window navigates rather than
   * spawning a second.
   */
  open(dir?: string): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      // A finished take lands in whichever window is already up, and closing it
      // afterwards should bring the panel back the way it would have from a
      // window this take opened.
      if (dir) this.fromCapture = true;

      // Asked for by name, so it is what shows: the tray's Open Recordings is
      // not a request to focus whatever happens to be on screen already.
      if (dir) this.showProject(dir);
      else this.showProjects();

      this.window.show();
      this.window.focus();
      return this.window;
    }

    // Before the window exists, so an unopenable directory throws at the call
    // site rather than producing a window with nothing in it.
    this.current = dir ? verifyRecording(dir) : null;
    this.fromCapture = dir !== undefined;

    const window = createWindow({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: this.current ? basename(this.current) : GRID_TITLE,
      // A dark-surfaced tool that ships its own background; leaving this white
      // flashes a white rectangle on open.
      backgroundColor: "#16171a",
    });

    this.window = window;

    // A packaged build has no devtools, so an error in this renderer would
    // otherwise go nowhere at all.
    mirrorConsole(window.webContents);

    // Re-sent on every load, which is what restores the editor after a reload
    // or an HMR round trip. Nothing to send while the grid is showing — it
    // asks for its own list.
    window.webContents.on("did-finish-load", () => this.push());

    // `ready-to-show` rather than showing immediately, so the window appears
    // with its first frame drawn instead of as an empty rectangle.
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });

    window.on("closed", () => {
      this.window = null;
      // Synchronous, and before anything else: the renderer's last debounced
      // save may still be in flight, and a window is closed by something that
      // does not wait for a promise.
      this.flush();
      this.options.onClose?.(this.fromCapture);
    });

    void loadRoute(window, "/workspace");

    this.options.onOpen?.();
    return window;
  }

  /**
   * Shows one recording in the editor.
   *
   * Throws for a directory that is not an openable recording, so the caller can
   * report it rather than the window going blank.
   */
  showProject(dir: string): void {
    const verified = verifyRecording(dir);
    if (this.current === verified) return;

    // The edit being left behind, before the next one loads. Two projects held
    // at once is exactly the state the single window exists to prevent.
    this.flush();
    this.current = verified;
    this.window?.setTitle(basename(verified));
    this.push();
  }

  /** Goes back to the grid, writing the edit being left behind. */
  showProjects(): void {
    this.flush();
    this.current = null;
    this.window?.setTitle(GRID_TITLE);
    // Told rather than assumed. The renderer does not decide this — the tray
    // can ask for the grid over an open editor, and deleting the recording on
    // screen takes the window off it.
    this.window?.webContents.send(IPC_CHANNELS.projectsShowing);
  }

  close(): void {
    // `close`, not `destroy`: the `closed` handler is what flushes the project
    // and puts the Dock icon away, and `destroy` skips it.
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }

  /** Sends the open recording to the renderer, if there is one. */
  private push(): void {
    const dir = this.current;
    const window = this.window;
    if (!dir || !window) return;

    void readEditorSession(dir)
      .then((session) => {
        // Still the same screen: loading probes the media, which takes long
        // enough for somebody to have gone back to the grid meanwhile.
        if (window.isDestroyed() || this.current !== dir) return;
        window.webContents.send(IPC_CHANNELS.editorOpen, session);
      })
      .catch((cause) => {
        console.warn(`[editor] could not load ${dir}:`, cause);
      });
  }

  private flush(): void {
    if (this.current) flushProject(this.current);
  }
}

/**
 * Checks a directory is an openable recording, and answers with its path.
 *
 * Deliberately cheap and synchronous: it runs before anything navigates, so an
 * unopenable directory throws at the call site instead of leaving a window
 * showing nothing.
 */
function verifyRecording(dir: string): string {
  parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
  return dir;
}
