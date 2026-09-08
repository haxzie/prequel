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
 * Settings is a pane of this window rather than a window of its own. It used to
 * be one, and the reason it stopped is the same reason the grid is here: a
 * menu-bar app has no app menu, so every surface it owns has to be found and
 * got back to, and three separate windows for one app is three things to find.
 *
 * The screen on show is pushed, never encoded in the route. The hash has to
 * survive a reload and an HMR round trip and a serialised manifest in it would
 * not — so the window always loads `/workspace`, and the renderer asks for
 * whichever recording was open as soon as it is mounted.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { BrowserWindow } from "electron";

import { IPC_CHANNELS, type WorkspaceSection } from "../../shared/contract.js";
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
  /**
   * Called when the window is focused.
   *
   * Open at login is owned by macOS, not by `preferences.json`, and the user
   * can change it in System Settings while the Settings pane sits open. The
   * tray gets away with reading it live because its menu is rebuilt on every
   * right-click; a window that stays open has to be told to look again.
   */
  onFocus?: () => void;
}

export class WorkspaceWindow {
  private window: BrowserWindow | null = null;
  /** The recording the editor is showing, or null on the library. */
  private current: string | null = null;
  /**
   * Which pane of the library is showing.
   *
   * Kept here rather than left to the renderer because the tray can ask for
   * Settings, and because it has to survive a reload the same way `current`
   * does — the renderer asks for both again on every mount.
   */
  private section: WorkspaceSection = "projects";
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
      // The chrome is translucent over whatever the window is sitting on, the
      // way a native editor's is.
      //
      // `hud` rather than `under-window`, which is what this was first written
      // as and which looked like nothing at all: `under-window` is the faintest
      // material AppKit has, and against dark chrome on a dark desktop the
      // difference from a flat fill is not visible. `hud` is heavily frosted and
      // already dark, which is what this palette wants. The renderer paints
      // three depths of scrim over it — see `--editor-glass` in `index.css` —
      // because a window gets exactly one material and the depth has to come
      // from somewhere.
      //
      // No `backgroundColor` to go with it. `createWindow` forces a transparent
      // one, because an opaque colour is painted over the material; the white
      // flash that `#16171a` used to prevent is already covered by
      // `ready-to-show` below, which holds the window back until it has a frame.
      vibrancy: "hud",
    });

    this.window = window;

    // A packaged build has no devtools, so an error in this renderer would
    // otherwise go nowhere at all.
    mirrorConsole(window.webContents);

    window.on("focus", () => this.options.onFocus?.());

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
   * Opens the window on one pane of the library, or moves the open one to it.
   *
   * The pane is set before anything is created: a new window pushes its state
   * on `did-finish-load`, and setting this afterwards would land it on the grid
   * and move it to Settings a frame later.
   */
  openSection(section: WorkspaceSection): void {
    this.section = section;

    if (!this.isOpen) {
      this.open();
      return;
    }

    // Off the editor if one is showing, writing its edit on the way: Settings
    // is a pane of the library, and the two share this window.
    this.showProjects(section);
    this.window?.show();
    this.window?.focus();
  }

  /**
   * Shows one recording in the editor.
   *
   * Throws for a directory that is not an openable recording, so the caller can
   * report it rather than the window going blank.
   */
  showProject(dir: string, announce = true): void {
    const verified = verifyRecording(dir);

    // Already the open one as far as main is concerned — but that is not the
    // same as the renderer showing it, and a window that missed the push is
    // exactly the window whose user clicks the recording again. Said again
    // rather than returned into silence, which left a card reading "Opening…"
    // for ever. No flush and no retitle: nothing is being left behind.
    if (this.current === verified) {
      this.push(announce);
      return;
    }

    // The edit being left behind, before the next one loads. Two projects held
    // at once is exactly the state the single window exists to prevent.
    this.flush();
    this.current = verified;
    this.window?.setTitle(basename(verified));
    this.push(announce);
  }

  /**
   * Goes back to the library, writing the edit being left behind.
   *
   * Lands on the grid unless asked for another pane. Leaving an editor is a
   * request for the list of recordings, not for wherever the sidebar happened
   * to be before one was opened.
   */
  showProjects(section: WorkspaceSection = "projects"): void {
    this.flush();
    this.current = null;
    this.section = section;
    this.window?.setTitle(GRID_TITLE);
    // Told rather than assumed. The renderer does not decide this — the tray
    // can ask for the grid over an open editor, and deleting the recording on
    // screen takes the window off it.
    this.window?.webContents.send(IPC_CHANNELS.projectsShowing);
    this.window?.webContents.send(IPC_CHANNELS.workspaceSection, this.section);
  }

  /**
   * Sends the window what it should be showing, at its own request.
   *
   * The renderer calls this once its view has mounted, which is the only moment
   * anything here can know a listener exists. Main used to push on
   * `did-finish-load` instead — that fires when the *page* has loaded, and every
   * view is a `lazy()` chunk fetched after that, so the section and the arriving
   * recording both went out to nobody and the window sat on the library.
   */
  ready(): void {
    this.push();
  }

  close(): void {
    // `close`, not `destroy`: the `closed` handler is what flushes the project
    // and puts the Dock icon away, and `destroy` skips it.
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }

  /**
   * Sends the open recording to the renderer, and the pane behind it.
   *
   * `announce` says whether to tell the renderer a recording is *coming*, ahead
   * of it arriving. Loading one probes its media and, on a take that has never
   * been opened, copies its background in — hundreds of milliseconds during
   * which this window is already on screen with no session to draw. It showed
   * the library for that gap, so stopping a recording flashed the grid before
   * the editor appeared, which reads as having opened the wrong thing.
   *
   * False from the grid, where the library is not a fallback but the screen the
   * user is standing on: a card there marks itself as opening and the list stays
   * put underneath, which is the better answer when the list is what you are
   * looking at.
   */
  private push(announce = true): void {
    const window = this.window;
    if (!window) return;

    // Always, and first: this is what a reload or an HMR round trip restores,
    // and the pane is as much part of where the window was as the recording is.
    window.webContents.send(IPC_CHANNELS.workspaceSection, this.section);

    const dir = this.current;
    if (!dir) return;

    if (announce) window.webContents.send(IPC_CHANNELS.editorOpening, dir);

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
