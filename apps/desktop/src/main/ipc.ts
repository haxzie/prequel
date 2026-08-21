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
  PermissionId,
  RecordingPreferences,
  ScreenMode,
  SelectionResult,
} from "../shared/contract.js";
import { IPC_CHANNELS } from "../shared/contract.js";
import type { ExportRequest } from "../shared/contract.js";
import type { Project } from "../shared/project.js";
import type { CaptureFlow } from "./capture-flow.js";
import { saveProject } from "./editor-project.js";
import { opensAtLogin, setOpensAtLogin } from "./login-item.js";
import { cancelExport, copyExport, dragExport, startExport } from "./export.js";
import { cancelTranscribe, startTranscribe } from "./transcribe/index.js";
import { permissionStates, relaunchApp, requestPermission } from "./permissions.js";
import { describeRecorderError, getRecorder } from "./recorder.js";
import { RECORDINGS_DIR, revealRecordings } from "./session.js";
import { captureWallpaper, copyPresetBackground, pickBackgroundImage } from "./wallpaper.js";
import { deleteRecording } from "./editor-session.js";

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
}

export function registerIpc({ flow }: IpcDeps): void {
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
  ipcMain.handle(IPC_CHANNELS.loginItem, () => opensAtLogin());

  ipcMain.handle(IPC_CHANNELS.setLoginItem, (_event, enabled: boolean) => {
    setOpensAtLogin(enabled);
    return opensAtLogin();
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

  ipcMain.handle(IPC_CHANNELS.editorDeleteRecording, (event, dir: string) =>
    attempt(() => deleteRecording(dir, BrowserWindow.fromWebContents(event.sender))),
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

  // `on`, not `handle`: see the channel's own note. This one is cleaned up by
  // `removeIpc`'s `removeAllListeners`, which `removeHandler` does not cover.
  ipcMain.on(IPC_CHANNELS.exportDrag, (event, path: string, icon: string) => {
    dragExport(event.sender, path, icon);
  });
}

/** Pushes panel state to every live renderer. */
export function broadcastDockState(state: DockState): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.dockChanged, state);
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
