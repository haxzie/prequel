/**
 * Every `ipcMain` handler, in one place.
 *
 * Handlers never reject on an expected condition — a denied permission, nothing
 * recording, a cancelled selection. Those come back as a tagged result the
 * renderer can act on, so the UI can show a recovery path instead of an
 * unhandled promise rejection.
 */
import { app, BrowserWindow, ipcMain, systemPreferences, webContents } from "electron";

import { env } from "@prequel/env";

import type {
  DockState,
  IpcResult,
  UpdateState,
  PermissionId,
  RecordingPreferences,
  ScreenMode,
  SelectionResult,
} from "../shared/contract.js";
import { IPC_CHANNELS } from "../shared/contract.js";
import type {
  AuthState,
  Entitlement,
  ExportFormat,
  ExportRequest,
  ShareRequest,
} from "../shared/contract.js";
import type { Project } from "../shared/project.js";
import { authState, beginSignIn, openDashboard, signOut } from "./auth.js";
import type { CaptureFlow } from "./capture-flow.js";
import { saveProject } from "./editor-project.js";
import { isBindable } from "../shared/accelerator.js";
import { loginItemState, setOpensAtLogin } from "./login-item.js";
import { setToggleShortcut } from "./shortcuts.js";
import { cancelExport, chooseExportTarget, copyExport, dragExport, startExport } from "./export.js";
import { entitlement, onEntitlementChanged, openUpgrade, refreshEntitlement } from "./licence.js";
import { cancelShare, startShare } from "./share.js";
import { cancelTranscribe, startTranscribe } from "./transcribe/index.js";
import { permissionStates, relaunchApp, requestPermission } from "./permissions.js";
import { describeRecorderError, getRecorder } from "./recorder.js";
import { listProjects, renameProject, saveFilmstrip, savePoster } from "./projects.js";
import { RECORDINGS_DIR, revealRecordings } from "./session.js";
import { sweepCaptions, writeCaption } from "./captions.js";
import { captureWallpaper, copyPresetBackground, pickBackgroundImage } from "./wallpaper.js";
import { deleteRecording } from "./editor-session.js";
import type { WorkspaceWindow } from "./windows/workspace.js";
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  openDownloadPage,
  updateState,
} from "./update.js";

/** Runs an operation, turning a native failure into a tagged result. */
async function attempt<T>(operation: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (cause) {
    return { ok: false, ...describeRecorderError(cause) };
  }
}

export interface IpcDeps {
  flow: CaptureFlow;
  /**
   * The app window, for the handlers that move it between its two screens.
   *
   * Reached directly rather than through the flow, unlike every other surface:
   * these are not capture commands, and routing "go back to the grid" through
   * the object that owns the recording lifecycle would put the library in it.
   */
  workspace: WorkspaceWindow;
}

export function registerIpc({ flow, workspace }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, () => ({
    name: env.NEXT_PUBLIC_APP_NAME,
    url: env.NEXT_PUBLIC_APP_URL,
    nodeEnv: env.NODE_ENV,
    version: app.getVersion(),
    recordingsDir: RECORDINGS_DIR,
    preferencesFile: flow.preferencesPath(),
  }));

  // ── permissions and the welcome flow ─────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.permissionStates, () => permissionStates());

  ipcMain.handle(IPC_CHANNELS.requestPermission, (_event, id: PermissionId) =>
    requestPermission(id),
  );

  ipcMain.handle(IPC_CHANNELS.relaunchApp, () => relaunchApp());

  // Read through to macOS rather than from a stored copy: Login Items is a
  // System Settings pane the user can change at any time, and a remembered
  // answer would start disagreeing with it the moment they did.
  ipcMain.handle(IPC_CHANNELS.loginItem, () => loginItemState());

  /**
   * Rebind the start/stop chord.
   *
   * Returns a result rather than throwing: an accelerator another application
   * already owns is an expected condition, not a fault, and the window needs to
   * say which one failed while the old binding carries on working.
   */
  ipcMain.handle(IPC_CHANNELS.setShortcut, (_event, accelerator: string) => {
    if (!isBindable(accelerator)) {
      return {
        ok: false,
        code: "SHORTCUT_UNBINDABLE",
        message: "Use at least one of Command, Control or Option.",
      } satisfies IpcResult<never>;
    }
    if (!setToggleShortcut(accelerator)) {
      return {
        ok: false,
        code: "SHORTCUT_TAKEN",
        // macOS gives us a boolean and no owner, so nothing here guesses one.
        message: "Something else on your Mac is already using that shortcut.",
      } satisfies IpcResult<never>;
    }
    const stored = flow.updatePreferences({ toggleShortcut: accelerator });
    return { ok: true, value: stored.preferences.toggleShortcut } satisfies IpcResult<string>;
  });

  ipcMain.handle(IPC_CHANNELS.setLoginItem, (_event, enabled: boolean) => {
    setOpensAtLogin(enabled);
    return loginItemState();
  });

  ipcMain.handle(IPC_CHANNELS.welcomeDone, () => flow.finishWelcome());

  ipcMain.handle(IPC_CHANNELS.listSources, () =>
    attempt(async () => (await getRecorder()).listTargets()),
  );

  // ── the panel ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.sessionState, () => flow.state());
  ipcMain.handle(IPC_CHANNELS.preferences, () => flow.state().preferences);

  ipcMain.handle(
    IPC_CHANNELS.updatePreferences,
    (_event, patch: Partial<RecordingPreferences>): DockState => flow.updatePreferences(patch),
  );

  ipcMain.handle(IPC_CHANNELS.chooseMode, (_event, mode: ScreenMode) =>
    attempt(() => flow.chooseMode(mode)),
  );

  ipcMain.handle(IPC_CHANNELS.startRecording, () => attempt(() => flow.record()));
  ipcMain.handle(IPC_CHANNELS.sessionStop, () => attempt(() => flow.stop()));
  ipcMain.handle(IPC_CHANNELS.sessionDiscard, () => attempt(() => flow.discard()));
  ipcMain.handle(IPC_CHANNELS.sessionTogglePause, () => attempt(() => flow.togglePause()));

  ipcMain.handle(IPC_CHANNELS.selectionChoose, (_event, result: SelectionResult) =>
    flow.chooseSelection(result),
  );
  ipcMain.handle(IPC_CHANNELS.selectionCancel, () => flow.cancelSelection());
  ipcMain.handle(IPC_CHANNELS.selectionCountdown, () => flow.warmCamera());

  /**
   * Asks macOS for camera or mic access.
   *
   * Device *labels* are only exposed to `enumerateDevices` once access is
   * granted, so the dropups would otherwise show a list of anonymous entries.
   */
  ipcMain.handle(
    IPC_CHANNELS.ensureDeviceAccess,
    async (_event, kind: "camera" | "microphone"): Promise<boolean> => {
      if (systemPreferences.getMediaAccessStatus(kind) === "granted") return true;
      return systemPreferences.askForMediaAccess(kind);
    },
  );

  ipcMain.handle(IPC_CHANNELS.dockMenu, (_event, open: boolean) => flow.setMenuOpen(open));

  ipcMain.handle(IPC_CHANNELS.dockWidth, (_event, width: number) => flow.setPanelWidth(width));

  ipcMain.handle(IPC_CHANNELS.cameraError, (_event, message: string | null) =>
    flow.reportCameraError(message),
  );

  ipcMain.handle(IPC_CHANNELS.revealRecordings, (_event, path?: string) => revealRecordings(path));

  ipcMain.handle(IPC_CHANNELS.closePopover, () => flow.close());

  // ── the editor ───────────────────────────────────────────────────────────
  //
  // Debounced by the renderer, which owns the edit — see `editor/state.ts` for
  // why the project does not live in main.
  ipcMain.handle(IPC_CHANNELS.editorSaveProject, (_event, dir: string, project: Project) =>
    attempt(() => saveProject(dir, project)),
  );

  ipcMain.handle(IPC_CHANNELS.editorWallpaper, (_event, dir: string) =>
    attempt(() => captureWallpaper(dir)),
  );

  ipcMain.handle(IPC_CHANNELS.editorPickImage, (_event, dir: string) =>
    attempt(() => pickBackgroundImage(dir)),
  );

  ipcMain.handle(IPC_CHANNELS.editorPresetImage, (_event, dir: string, presetId: string) =>
    attempt(() => copyPresetBackground(dir, presetId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.editorWriteCaption,
    (_event, dir: string, file: string, bytes: Uint8Array) =>
      attempt(() => writeCaption(dir, file, bytes)),
  );

  ipcMain.handle(IPC_CHANNELS.editorSweepCaptions, (_event, dir: string, keep: string[]) =>
    attempt(() => sweepCaptions(dir, keep)),
  );

  // ── the library ──────────────────────────────────────────────────────────
  //
  // Tagged like the rest of them, and not because the scan throws — it already
  // answers with an empty list for an unreadable folder. The renderer reads
  // `result.ok` before `result.value`, so a bare array here is a grid that says
  // "No recordings yet" over a folder with a hundred takes in it, with nothing
  // logged on either side. `ipcMain.handle` does not check what its callback
  // returns and `invoke` answers `any`, so nothing but this catches it.
  ipcMain.handle(IPC_CHANNELS.projectsList, () => attempt(() => listProjects()));

  ipcMain.handle(IPC_CHANNELS.projectsOpen, (_event, dir: string) =>
    // Answered by a push on `editor:open` rather than by this promise: opening
    // a recording probes its media, and the window has to be drawing while that
    // happens rather than waiting on it.
    attempt(() => workspace.showProject(dir)),
  );

  ipcMain.handle(IPC_CHANNELS.projectsShow, () => attempt(() => workspace.showProjects()));

  ipcMain.handle(IPC_CHANNELS.projectsRename, (_event, dir: string, name: string) =>
    attempt(() => renameProject(dir, name)),
  );

  ipcMain.handle(IPC_CHANNELS.projectsDelete, (event, dir: string) =>
    attempt(async () => {
      const deleted = await deleteRecording(dir, BrowserWindow.fromWebContents(event.sender));
      // Back to the grid rather than closing: the editor and the grid share one
      // window, and closing it over a delete would take the whole app off
      // screen. Only when it was this recording on show — a delete from the
      // grid leaves the grid exactly where it is.
      if (deleted && workspace.currentDir === dir) workspace.showProjects();
      return deleted;
    }),
  );

  ipcMain.handle(IPC_CHANNELS.projectsSavePoster, (_event, dir: string, dataUrl: string) =>
    attempt(() => savePoster(dir, dataUrl)),
  );

  ipcMain.handle(IPC_CHANNELS.projectsSaveFilmstrip, (_event, dir: string, dataUrl: string) =>
    attempt(() => saveFilmstrip(dir, dataUrl)),
  );

  // The sheet hangs off the window that asked, so it cannot open behind the
  // editor it belongs to.
  ipcMain.handle(IPC_CHANNELS.exportChoose, (event, format: ExportFormat) =>
    attempt(() => chooseExportTarget(format, BrowserWindow.fromWebContents(event.sender))),
  );

  ipcMain.handle(IPC_CHANNELS.exportStart, (_event, request: ExportRequest) =>
    attempt(() => startExport(request)),
  );

  ipcMain.handle(IPC_CHANNELS.exportCancel, () => attempt(() => cancelExport()));

  ipcMain.handle(IPC_CHANNELS.exportCopy, (_event, path: string) =>
    attempt(() => copyExport(path)),
  );

  ipcMain.handle(IPC_CHANNELS.transcribeStart, (_event, dir: string) =>
    attempt(() => startTranscribe(dir)),
  );

  ipcMain.handle(IPC_CHANNELS.transcribeCancel, () => attempt(() => cancelTranscribe()));

  ipcMain.handle(IPC_CHANNELS.authState, () => authState());

  // Answers as soon as the browser is open, not when the sign-in finishes. The
  // result comes back on `authChanged`, because the user may take minutes over
  // it or never come back at all — and a promise awaiting that would leave the
  // button that called it spinning for ever.
  ipcMain.handle(IPC_CHANNELS.authSignIn, () => attempt(() => beginSignIn()));

  ipcMain.handle(IPC_CHANNELS.authSignOut, () => attempt(() => signOut()));

  ipcMain.handle(IPC_CHANNELS.authOpenDashboard, () => attempt(() => openDashboard()));

  // ── updates ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.updateState, () => updateState());

  ipcMain.handle(IPC_CHANNELS.updateCheck, () => checkForUpdates());

  // Answers when the download finishes, but nothing waits on it: progress
  // arrives on `updateChanged` many times a second, and that is what the window
  // draws from.
  ipcMain.handle(IPC_CHANNELS.updateDownload, () => downloadUpdate());

  // Two outcomes on one channel because the window offers one button either
  // way: install what was downloaded, or — when Squirrel cannot replace this
  // build, which an unsigned copy never can — open the download page instead.
  ipcMain.handle(IPC_CHANNELS.updateInstall, () => {
    if (updateState().status === "ready") installUpdate();
    else openDownloadPage();
  });

  // Through the flow, like every other request for a surface — one place knows
  // what opening a window entails.
  ipcMain.handle(IPC_CHANNELS.updateOpen, () => flow.openUpdate());

  // ── the licence ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.licenceState, () => entitlement());

  // Not wrapped in `attempt`: a failed check is not a failed call. `licence.ts`
  // answers with the last thing it knew, so the renderer always receives a
  // verdict rather than a result it has to decide how to read.
  ipcMain.handle(IPC_CHANNELS.licenceCheck, () => refreshEntitlement());

  ipcMain.handle(IPC_CHANNELS.licenceUpgrade, () => openUpgrade());

  ipcMain.handle(IPC_CHANNELS.shareStart, (_event, share: ShareRequest) =>
    attempt(() => startShare(share)),
  );

  ipcMain.handle(IPC_CHANNELS.shareCancel, () => attempt(() => cancelShare()));

  // `on`, not `handle`: see the channel's own note. This one is cleaned up by
  // `removeIpc`'s `removeAllListeners`, which `removeHandler` does not cover.
  ipcMain.on(IPC_CHANNELS.exportDrag, (event, path: string, icon: string) => {
    dragExport(event.sender, path, icon);
  });
}

/**
 * Tells every window how far along an update is.
 *
 * Broadcast because four surfaces show it — the update window, the tray menu,
 * the Settings pane and the recording panel — and the download progress that
 * drives it arrives many times a second from a place none of them can see.
 */
export function broadcastUpdateState(state: UpdateState): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.updateChanged, state);
  }
}

/** Pushes panel state to every live renderer. */
/** Tells every open window what macOS now says about opening at login. */
export function broadcastLoginItem(enabled: boolean | null): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.loginItemChanged, enabled);
  }
}

export function broadcastDockState(state: DockState): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.dockChanged, state);
  }
}

/**
 * Tells every window who is signed in.
 *
 * Broadcast because three surfaces show it — the welcome flow, the settings
 * pane and the export dialog's Share button — and two of them being open at
 * once with different answers is exactly the disagreement a broadcast exists to
 * prevent.
 */
export function broadcastAuthState(state: AuthState): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.authChanged, state);
  }
}

/**
 * Tells every window whether this Mac may export.
 *
 * Broadcast for the same reason the auth state is: the verdict changes while a
 * browser is open somewhere else, and the upgrade dialog waiting on it is not
 * necessarily in the window that opened the browser.
 */
export function broadcastEntitlement(value: Entitlement): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.licenceChanged, value);
  }
}

export function removeIpc(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
    // `removeHandler` only undoes `handle`. A channel registered with `on`
    // would survive it and be registered a second time on the next
    // `registerIpc`, so every drag would then start twice.
    ipcMain.removeAllListeners(channel);
  }
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
}
