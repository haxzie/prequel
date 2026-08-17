import { contextBridge, ipcRenderer } from "electron";

import type {
  AppInfo,
  BackgroundImage,
  DockState,
  EditorSession,
  ExportProgress,
  ExportRequest,
  IpcResult,
  PermissionId,
  PermissionState,
  PermissionStatus,
  RecordingPreferences,
  ScreenMode,
  SelectionResult,
  SelectionSetup,
  Target,
} from "../shared/contract.js";
import { IPC_CHANNELS } from "../shared/contract.js";
import type { Project } from "../shared/project.js";

export type {
  AppInfo,
  BackgroundImage,
  DockState,
  EditorSession,
  ExportProgress,
  ExportRequest,
  IpcResult,
  PermissionId,
  PermissionState,
  PermissionStatus,
  RecordingPreferences,
  ScreenMode,
  SelectionResult,
  SelectionSetup,
  Target,
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

  dock: {
    state: (): Promise<DockState> => ipcRenderer.invoke(IPC_CHANNELS.sessionState),
    chooseMode: (mode: ScreenMode): Promise<IpcResult<DockState>> =>
      ipcRenderer.invoke(IPC_CHANNELS.chooseMode, mode),
    updatePreferences: (patch: Partial<RecordingPreferences>): Promise<DockState> =>
      ipcRenderer.invoke(IPC_CHANNELS.updatePreferences, patch),
    record: (): Promise<IpcResult<DockState>> => ipcRenderer.invoke(IPC_CHANNELS.startRecording),
    stop: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC_CHANNELS.sessionStop),
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

    /**
     * Moves the whole recording to the Trash and closes its window.
     *
     * Resolves false when the user declines the confirmation, so the caller can
     * tell "did not happen" from "failed".
     */
    deleteRecording: (dir: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(IPC_CHANNELS.editorDeleteRecording, dir),

    /** Copies one of the shipped wallpapers into the recording. */
    presetImage: (dir: string, presetId: string): Promise<IpcResult<BackgroundImage | null>> =>
      ipcRenderer.invoke(IPC_CHANNELS.editorPresetImage, dir, presetId),

    export: {
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
  },

  sources: {
    list: (): Promise<IpcResult<Target[]>> => ipcRenderer.invoke(IPC_CHANNELS.listSources),
  },

  library: {
    reveal: (path?: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.revealRecordings, path),
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld("prequel", api);
