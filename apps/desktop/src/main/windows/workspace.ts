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
 * The screen on show *is* the route: `/workspace` for the library, and
 * `/editor/<name>` for one recording. It used to be pushed instead, on the
 * grounds that a hash had to survive a reload and a serialised manifest in one
 * would not — but a recording's folder name survives both, and the editor now
 * fetches the rest for itself. What that buys is one answer to "where is this
 * window": a reload lands where it was without main replaying anything.
 *
 * This class keeps `current` all the same, because three things in main depend
 * on knowing which recording is on screen: the flush that makes the invariant
 * above true, the window title, and the delete that has to take the window off
 * a recording it just removed. The renderer reports both ends of a visit
 * (`editor:session` and `editor:leave`) and this is where that is recorded.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { BrowserWindow } from "electron";

import { IPC_CHANNELS, type WorkspaceSection } from "../../shared/contract.js";
import { MANIFEST_FILE_NAME, parseManifest } from "../../shared/manifest.js";
import { flushProject } from "../editor-project.js";
import { mirrorConsole } from "../log.js";
import { recordingPath } from "../session.js";
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
      if (dir) this.openRecording(dir);
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

    // Straight to the screen it was opened for. A window that always loaded the
    // library and was then told to move showed the grid for a frame on its way
    // to an editor, which is what `editor:opening` used to paper over.
    void loadRoute(window, this.current ? editorRoute(this.current) : "/workspace");

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
   * Puts the window on one recording's editor.
   *
   * Verified here rather than in the route, so a directory that is not an
   * openable recording throws at the call site — the tray's Open Recent can
   * then report it, where a window that had already navigated could only show
   * an error in place of the editor.
   *
   * No flush and no `current` here. The renderer reports both ends of a visit,
   * and doing it from this side as well would mean guessing at an order the
   * renderer actually decides: it unmounts the editor it is leaving (which
   * flushes) before mounting the next one.
   */
  openRecording(dir: string): void {
    const verified = verifyRecording(dir);
    this.navigate(editorRoute(verified));
  }

  /**
   * Goes back to the library, writing the edit being left behind.
   *
   * Lands on the grid unless asked for another pane. Leaving an editor is a
   * request for the list of recordings, not for wherever the sidebar happened
   * to be before one was opened.
   */
  showProjects(section: WorkspaceSection = "projects"): void {
    // Belt and braces. Leaving an editor flushes from the renderer's own
    // cleanup, and this is the same call again for the case where that never
    // ran — a renderer that crashed, or a window told to move while its editor
    // was mid-mount. `flushProject` is a no-op when nothing is held.
    this.flush();
    this.current = null;
    this.section = section;
    this.window?.setTitle(GRID_TITLE);
    this.navigate("/workspace");
    this.window?.webContents.send(IPC_CHANNELS.workspaceSection, this.section);
  }

  /**
   * Records that the renderer is now showing a recording, and answers with it.
   *
   * The one place `current` moves forward. Flushing here rather than on the way
   * out covers the case the way out cannot: two editors in a row, where the
   * second mounts before anything told this side the first had gone.
   *
   * `null` for a name that does not resolve to a recording inside the library,
   * which the route treats as "this could not be opened" rather than throwing
   * an error at somebody who only clicked a card.
   */
  enterRecording(name: string): string | null {
    const dir = recordingPath(name);
    if (!dir) return null;

    if (this.current !== dir) this.flush();
    this.current = dir;
    this.window?.setTitle(basename(dir));
    return dir;
  }

  /**
   * Records that the renderer has left the recording it was showing.
   *
   * Called from the editor route's cleanup, which React runs before the next
   * screen mounts. What it protects is `editor-project`'s pending map: an entry
   * left there outlives the editor that made it, and `loadProject` prefers it to
   * the file on disk, so a stale one is what a later open or a rename reads.
   */
  leaveRecording(): void {
    this.flush();
    this.current = null;
    this.window?.setTitle(GRID_TITLE);
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
   * Sends the window the pane it should be showing.
   *
   * All that is left of what this used to push. The recording is in the route
   * now, so a mounted renderer already knows which one it is on; the pane is
   * still main's, because the tray's Settings item has no other way in.
   */
  private push(): void {
    this.window?.webContents.send(IPC_CHANNELS.workspaceSection, this.section);
  }

  /**
   * Tells an open window to go somewhere.
   *
   * Only for moves the renderer cannot know about: the tray, a finished
   * capture, a delete taking the window off what it removed. Anything the user
   * clicks in the window navigates there and tells this side afterwards.
   */
  private navigate(route: string): void {
    this.window?.webContents.send(IPC_CHANNELS.workspaceNavigate, route);
  }

  private flush(): void {
    if (this.current) flushProject(this.current);
  }
}

/**
 * The route that shows one recording.
 *
 * Encoded here and nowhere else. `loadRoute` concatenates its argument straight
 * into a URL, and every recording's name has spaces in it, so a raw name would
 * arrive at the renderer already broken.
 */
function editorRoute(dir: string): string {
  return `/editor/${encodeURIComponent(basename(dir))}`;
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
