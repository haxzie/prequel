import { contextBridge, ipcRenderer } from "electron";

import type {
  BackgroundsCatalogue,
  AppInfo,
  AuthState,
  BackgroundImage,
  DockState,
  EditorSession,
  Entitlement,
  ExportFormat,
  ExportProgress,
  ExportRequest,
  IpcResult,
  PermissionId,
  PermissionState,
  PermissionStatus,
  ProjectSummary,
  RecordingPreferences,
  ScreenMode,
  SelectionResult,
  SelectionSetup,
  ShareProgress,
  ShareRequest,
  Target,
  TranscribeProgress,
  UpdateState,
  WorkspaceSection,
} from "../shared/contract.js";
import { IPC_CHANNELS } from "../shared/contract.js";
import type { Project } from "../shared/project.js";

export type {
  AppInfo,
  BackgroundImage,
  DockState,
  EditorSession,
  Entitlement,
  ExportFormat,
  ExportProgress,
  ExportRequest,
  IpcResult,
  PermissionId,
  PermissionState,
  PermissionStatus,
  ProjectSummary,
  RecordingPreferences,
  ScreenMode,
  SelectionResult,
  SelectionSetup,
  Target,
  TranscribeProgress,
  UpdateState,
  WorkspaceSection,
};

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo),

  permissions: {
    /** Every permission's state. One call, so a list cannot be half-refreshed. */
    list: (): Promise<PermissionState[]> => ipcRenderer.invoke(IPC_CHANNELS.permissionStates),

    /** Asks for one, and answers with all of them as they stand afterwards. */
    request: (id: PermissionId): Promise<PermissionState[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.requestPermission, id),

    /** Prompts for camera or mic access; device labels depend on it. */
    ensureDevice: (kind: "camera" | "microphone"): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.ensureDeviceAccess, kind),
  },

  welcome: {
    /** Closes the welcome window and opens the panel. */
    done: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.welcomeDone),

    /** Quits and comes back, which is what a new Screen Recording grant needs. */
    relaunch: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.relaunchApp),
  },

  loginItem: {
    /** Whether macOS starts Prequel when the user logs in. */
    get: (): Promise<boolean | null> => ipcRenderer.invoke(IPC_CHANNELS.loginItem),

    /**
     * Adds or removes the login item, and answers with what macOS ended up with.
     *
     * The answer rather than the request: under `pnpm dev` there is no bundle to
     * register, so the switch has to show what actually happened instead of
     * what was asked for.
     */
    set: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.setLoginItem, enabled),

    /**
     * Subscribes to the value macOS holds. Returns an unsubscribe function.
     *
     * A settings window stays open while the user can go and change Login Items
     * in System Settings, so the switch has to be told to look again rather
     * than trusting what it read when it mounted.
     */
    onChange: (listener: (enabled: boolean) => void): (() => void) => {
      const handler = (_event: unknown, enabled: boolean) => listener(enabled);
      ipcRenderer.on(IPC_CHANNELS.loginItemChanged, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.loginItemChanged, handler);
    },
  },

  settings: {
    /**
     * Rebinds the global start/stop chord.
     *
     * Fails rather than throws when the combination is taken — the old binding
     * is still live at that point, and the window says so.
     */
    setShortcut: (accelerator: string): Promise<IpcResult<string>> =>
      ipcRenderer.invoke(IPC_CHANNELS.setShortcut, accelerator),
  },

  dock: {
    state: (): Promise<DockState> => ipcRenderer.invoke(IPC_CHANNELS.sessionState),
    chooseMode: (mode: ScreenMode): Promise<IpcResult<DockState>> =>
      ipcRenderer.invoke(IPC_CHANNELS.chooseMode, mode),
    updatePreferences: (patch: Partial<RecordingPreferences>): Promise<DockState> =>
      ipcRenderer.invoke(IPC_CHANNELS.updatePreferences, patch),
    record: (): Promise<IpcResult<DockState>> => ipcRenderer.invoke(IPC_CHANNELS.startRecording),
    stop: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.sessionStop),
    /** Stops and deletes the take. There is no undo. */
    discard: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.sessionDiscard),
    togglePause: (): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionTogglePause),
    close: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.closePopover),

    /**
     * Tells main a drop-up opened or closed.
     *
     * The window is only as tall as the panel, so it has to grow before a menu
     * can be drawn above it — otherwise the menu is clipped to a sliver.
     */
    setMenuOpen: (open: boolean): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.dockMenu, open),

    /**
     * Reports how wide the panel wants to be.
     *
     * The window cannot work this out for itself — device names vary from
     * "Camera" to "MacBook Pro Microphone (Built-in)" — so the renderer
     * measures and main resizes to match.
     */
    setWidth: (width: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.dockWidth, width),

    /** Reports that the camera preview failed, or recovered (`null`). */
    reportCameraError: (message: string | null): Promise<DockState> =>
      ipcRenderer.invoke(IPC_CHANNELS.cameraError, message),

    /** Subscribes to panel state. Returns an unsubscribe function. */
    onChange: (listener: (state: DockState) => void): (() => void) => {
      const handler = (_event: unknown, state: DockState) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.dockChanged, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.dockChanged, handler);
    },
  },

  selection: {
    /** Fires once per overlay, with that display's geometry. */
    onSetup: (listener: (setup: SelectionSetup) => void): (() => void) => {
      const handler = (_event: unknown, setup: SelectionSetup) => listener(setup);
      ipcRenderer.on(IPC_CHANNELS.selectionSetup, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.selectionSetup, handler);
    },
    choose: (result: SelectionResult): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.selectionChoose, result),
    cancel: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.selectionCancel),
    /** The countdown has started; main opens the camera so it can warm up. */
    countdown: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.selectionCountdown),
  },

  editor: {
    /**
     * Fires once the window has loaded, with the recording it was opened for.
     *
     * Re-sent on every load, so a reload or an HMR round trip restores the
     * session rather than leaving an editor with nothing to edit.
     */
    onOpen: (listener: (session: EditorSession) => void): (() => void) => {
      const handler = (_event: unknown, session: EditorSession) => listener(session);
      ipcRenderer.on(IPC_CHANNELS.editorOpen, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.editorOpen, handler);
    },

    /** Persists the edit. Debounced by the renderer, which owns it. */
    saveProject: (dir: string, project: Project): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC_CHANNELS.editorSaveProject, dir, project),

    /** Copies the current desktop picture into the recording. */
    wallpaper: (dir: string): Promise<IpcResult<BackgroundImage | null>> =>
      ipcRenderer.invoke(IPC_CHANNELS.editorWallpaper, dir),

    /** Opens a file picker and copies the chosen image into the recording. */
    pickImage: (dir: string): Promise<IpcResult<BackgroundImage | null>> =>
      ipcRenderer.invoke(IPC_CHANNELS.editorPickImage, dir),

    /** Copies one of the shipped wallpapers into the recording. */
    presetImage: (dir: string, presetId: string): Promise<IpcResult<BackgroundImage | null>> =>
      ipcRenderer.invoke(IPC_CHANNELS.editorPresetImage, dir, presetId),

    export: {
      /**
       * Asks where to write the export, with a save dialog.
       *
       * Resolves to null when the sheet was dismissed, which is not a failure —
       * nothing was started and nothing needs reporting.
       */
      choose: (format: ExportFormat): Promise<IpcResult<string | null>> =>
        ipcRenderer.invoke(IPC_CHANNELS.exportChoose, format),

      start: (request: ExportRequest): Promise<IpcResult<void>> =>
        ipcRenderer.invoke(IPC_CHANNELS.exportStart, request),
      cancel: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.exportCancel),

      /**
       * Subscribes to export progress.
       *
       * Completion arrives here as a terminal stage rather than as a resolved
       * promise from `start`, so there is one channel and no race between
       * "done" and the tick before it.
       */
      onProgress: (listener: (progress: ExportProgress) => void): (() => void) => {
        const handler = (_event: unknown, progress: ExportProgress) => listener(progress);
        ipcRenderer.on(IPC_CHANNELS.exportProgress, handler);
        return () => ipcRenderer.off(IPC_CHANNELS.exportProgress, handler);
      },

      /** Puts a finished export on the pasteboard as a file, not as its path. */
      copy: (path: string): Promise<IpcResult<void>> =>
        ipcRenderer.invoke(IPC_CHANNELS.exportCopy, path),

      /**
       * Starts a native drag carrying a finished export.
       *
       * `send` rather than `invoke`, and called straight from `dragstart`:
       * `webContents.startDrag` only takes hold while the mouse is still down,
       * and a promise round trip is long enough to miss that window.
       *
       * `icon` is a PNG data URL and must not be empty — Electron throws on an
       * empty one, and macOS shows nothing under the pointer without it.
       */
      drag: (path: string, icon: string): void => {
        ipcRenderer.send(IPC_CHANNELS.exportDrag, path, icon);
      },
    },

    share: {
      /**
       * Uploads a finished export to the team's library.
       *
       * Resolves once the upload has been *accepted*, not once it has finished.
       * The link arrives on `onProgress` with the terminal stage, so a dialog
       * that is closed mid-upload and reopened sees where it got to rather than
       * having missed the only notification.
       */
      start: (request: ShareRequest): Promise<IpcResult<void>> =>
        ipcRenderer.invoke(IPC_CHANNELS.shareStart, request),

      cancel: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.shareCancel),

      onProgress: (listener: (progress: ShareProgress) => void): (() => void) => {
        const handler = (_event: unknown, progress: ShareProgress) => listener(progress);
        ipcRenderer.on(IPC_CHANNELS.shareProgress, handler);
        return () => ipcRenderer.off(IPC_CHANNELS.shareProgress, handler);
      },
    },

    transcribe: {
      start: (dir: string): Promise<IpcResult<void>> =>
        ipcRenderer.invoke(IPC_CHANNELS.transcribeStart, dir),
      cancel: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.transcribeCancel),

      /**
       * Subscribes to transcription progress.
       *
       * The finished transcript arrives on the terminal event rather than from
       * `start`, for the same reason the export's does: one channel, and no
       * race between the result and the tick before it.
       */
      onProgress: (listener: (progress: TranscribeProgress) => void): (() => void) => {
        const handler = (_event: unknown, progress: TranscribeProgress) => listener(progress);
        ipcRenderer.on(IPC_CHANNELS.transcribeProgress, handler);
        return () => ipcRenderer.off(IPC_CHANNELS.transcribeProgress, handler);
      },
    },

    backgrounds: {
      /**
       * The hosted catalogue, or null when there is neither a cache nor a
       * network — the picker then falls back to what the app ships.
       */
      catalogue: (): Promise<IpcResult<BackgroundsCatalogue | null>> =>
        ipcRenderer.invoke(IPC_CHANNELS.backgroundsCatalogue),

      /** Caches one thumbnail. Answers whether it can be drawn now. */
      thumbnail: (file: string): Promise<IpcResult<boolean>> =>
        ipcRenderer.invoke(IPC_CHANNELS.backgroundsThumbnail, file),

      /** Puts the full picture inside the recording, so it can be drawn. */
      ensure: (dir: string, file: string): Promise<IpcResult<boolean>> =>
        ipcRenderer.invoke(IPC_CHANNELS.backgroundsEnsure, dir, file),
    },

    captions: {
      /**
       * Hands main one cue's pixels to write into the recording.
       *
       * Answers with the path it wrote, or null if it could not — a missing
       * bitmap is a plainer video, and the rest of the cues are still worth
       * drawing.
       */
      write: (dir: string, file: string, bytes: Uint8Array): Promise<IpcResult<string | null>> =>
        ipcRenderer.invoke(IPC_CHANNELS.editorWriteCaption, dir, file, bytes),

      sweep: (dir: string, keep: string[]): Promise<IpcResult<void>> =>
        ipcRenderer.invoke(IPC_CHANNELS.editorSweepCaptions, dir, keep),
    },
  },

  sources: {
    list: (): Promise<IpcResult<Target[]>> => ipcRenderer.invoke(IPC_CHANNELS.listSources),
  },

  library: {
    reveal: (path?: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.revealRecordings, path),
  },

  /**
   * The local library, as the Projects grid works with it.
   *
   * `open` and `show` move the one app window between its two screens; the
   * editor arrives on `editor.onOpen`, not as their result, because loading a
   * recording probes its media.
   */
  projects: {
    list: (): Promise<IpcResult<ProjectSummary[]>> => ipcRenderer.invoke(IPC_CHANNELS.projectsList),

    /** Shows this recording in the editor. Answered on `editor.onOpen`. */
    open: (dir: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsOpen, dir),

    /** Back to the grid. Main writes the edit being left behind. */
    show: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.projectsShow),

    /**
     * Fires when the grid becomes what the window is showing.
     *
     * The answer to `show`, and to anything else that takes the window off a
     * recording — the tray asking for the grid over an open editor, or the
     * recording on screen being deleted.
     */
    onShowing: (listener: () => void): (() => void) => {
      const handler = () => listener();
      ipcRenderer.on(IPC_CHANNELS.projectsShowing, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.projectsShowing, handler);
    },

    rename: (dir: string, name: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsRename, dir, name),

    /**
     * Moves the whole recording to the Trash.
     *
     * Resolves false when the user declines the confirmation, so the caller can
     * tell "did not happen" from "failed".
     */
    delete: (dir: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsDelete, dir),

    /** Caches a still the grid made, so the next open does not have to. */
    savePoster: (dir: string, dataUrl: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsSavePoster, dir, dataUrl),

    /** The same for the hover preview, which is made on the first hover. */
    saveFilmstrip: (dir: string, dataUrl: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsSaveFilmstrip, dir, dataUrl),
  },

  /**
   * The app window itself.
   *
   * Only the sidebar, and only in one direction: which pane is showing is the
   * renderer's own business right up until the tray asks for Settings, which
   * has no window of its own to open any more.
   */
  workspace: {
    onSection: (listener: (section: WorkspaceSection) => void): (() => void) => {
      const handler = (_event: unknown, section: WorkspaceSection) => listener(section);
      ipcRenderer.on(IPC_CHANNELS.workspaceSection, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.workspaceSection, handler);
    },
  },

  /**
   * Whether this Mac may export.
   *
   * `state` is what is already known and answers instantly; `check` asks the
   * server. The Export button calls `check`, because that is the one moment
   * the answer matters and the user is already waiting through it.
   */
  licence: {
    state: (): Promise<Entitlement> => ipcRenderer.invoke(IPC_CHANNELS.licenceState),
    check: (): Promise<Entitlement> => ipcRenderer.invoke(IPC_CHANNELS.licenceCheck),
    /** Opens the billing page in the default browser. */
    upgrade: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.licenceUpgrade),
    onChange: (listener: (entitlement: Entitlement) => void): (() => void) => {
      const handler = (_event: unknown, value: Entitlement) => listener(value);
      ipcRenderer.on(IPC_CHANNELS.licenceChanged, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.licenceChanged, handler);
    },
  },

  auth: {
    /** The account, redacted. The device token never crosses this boundary. */
    state: (): Promise<AuthState> => ipcRenderer.invoke(IPC_CHANNELS.authState),

    /**
     * Opens the browser.
     *
     * Resolves once it is open, not once the sign-in is done — that answer comes
     * back through `onChange`, because it depends on a person and a second
     * application and may never arrive at all.
     */
    signIn: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.authSignIn),

    signOut: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.authSignOut),

    /** The team's library, in the default browser. */
    openDashboard: (): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC_CHANNELS.authOpenDashboard),

    onChange: (listener: (state: AuthState) => void): (() => void) => {
      const handler = (_event: unknown, state: AuthState) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.authChanged, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.authChanged, handler);
    },
  },

  update: {
    /** How far along an update is, including the version running now. */
    state: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.updateState),

    /** Looks for a newer version. Resolves with the state the check ended in. */
    check: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),

    /**
     * Starts the download.
     *
     * Resolves when it finishes, but nothing should wait on that — progress
     * arrives on `onChange` many times a second, and that is what to draw.
     */
    download: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.updateDownload),

    /**
     * Quits and comes back on the new version.
     *
     * Or opens the download page, when Squirrel cannot replace this build —
     * which an unsigned copy never can. One call because the window offers one
     * button either way, and only main can tell the two apart.
     */
    install: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.updateInstall),

    /** Brings up the update window, which has room for notes and progress. */
    open: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.updateOpen),

    onChange: (listener: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: unknown, state: UpdateState) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.updateChanged, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.updateChanged, handler);
    },
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld("prequel", api);
