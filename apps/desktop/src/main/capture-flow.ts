/**
 * The setup-then-record flow behind the bottom panel.
 *
 * Sequencing matters in a way that is easy to get wrong: every window of ours
 * that will be on screen during the recording must exist *before* capture
 * starts, because its `CGWindowID` is what keeps it out of the frame. A window
 * created afterwards will be recorded.
 */
import { screen, type BrowserWindow } from "electron";

import type {
  DockState,
  DockView,
  PendingSelection,
  RecordingPreferences,
  ScreenMode,
  Target,
} from "../shared/contract.js";
import { withoutDeviceIds } from "../shared/contract.js";
import { iconsFor } from "./app-icons.js";
import { track } from "./analytics.js";
import { log } from "./log.js";
import type { Preferences } from "./preferences.js";
import type { NativeCamera } from "./recorder.js";
import { getRecorder } from "./recorder.js";
import { deleteRecording } from "./session.js";
import type { RecordingSession } from "./session.js";
import { windowId } from "./windows/base.js";
import type { CameraWindow } from "./windows/camera.js";
import type { DockWindow } from "./windows/dock.js";
import { screenTargetFor, SelectionOverlay } from "./windows/selection.js";

/**
 * How often the window picker re-reads what is on screen.
 *
 * The list it opens with is a snapshot, and it is stale as soon as anything
 * moves — a window brought forward keeps its old place in the stack until the
 * picker is reopened. Listing costs ~20 ms, so this is comfortably cheap
 * enough to run while the overlay is up, and slow enough not to churn.
 */
const WINDOW_REFRESH_MS = 700;

/**
 * Finds the AVFoundation camera behind a label the panel picked up from
 * `navigator.mediaDevices`.
 *
 * Exported for tests: this is the join between two device namespaces that do
 * not agree, and getting it wrong means the camera is silently absent.
 */
export function matchCamera(label: string, cameras: NativeCamera[]): NativeCamera | undefined {
  const stripped = withoutDeviceIds(label);
  return (
    cameras.find((camera) => camera.name === label) ??
    cameras.find((camera) => camera.name === stripped) ??
    // Last resort: some names differ by more than the suffix, but Chromium
    // always builds its label by extending the native one.
    cameras.find((camera) => stripped.startsWith(camera.name))
  );
}

/**
 * App icons for a set of window targets, keyed by `CGWindowID`.
 *
 * Goes via each window's owning bundle rather than `desktopCapturer`, whose
 * `appIcon` is 32×32 and looks it at any size worth drawing.
 */
async function windowIcons(targets: Target[]): Promise<Map<number, string>> {
  const windows = targets.filter((target) => target.kind === "Window" && target.appPath);
  const byBundle = await iconsFor(windows.map((target) => target.appPath));

  const icons = new Map<number, string>();
  for (const target of windows) {
    const icon = byBundle.get(target.appPath);
    if (icon) icons.set(target.id, icon);
  }
  return icons;
}

export interface CaptureFlowOptions {
  session: RecordingSession;
  dock: DockWindow;
  camera: CameraWindow;
  selection: SelectionOverlay;
  preferences: Preferences;
  onChange: (state: DockState) => void;
  /**
   * The app window: the Projects grid, and the editor.
   *
   * Called with a directory to land on that recording, without one to land on
   * the grid. Injected rather than imported so the flow stays testable without
   * Electron, and so a failure to open the window cannot take the stop path
   * down with it.
   */
  workspace?: { open: (dir?: string) => void };
  /**
   * The welcome window, for closing it once the flow is finished.
   *
   * Injected for the same reasons as `workspace`, and optional for the same
   * reason: nothing about capture depends on it existing.
   */
  welcome?: { close: () => void };
  /**
   * The settings window, for the tray to reach through the flow.
   *
   * Injected for the same reasons as the two above. The tray never touches a
   * window class directly — everything it does goes through here, so there is
   * one place that knows what opening a surface entails.
   */
  settings?: { open: () => void };
  /**
   * The update window, for the tray to reach through the flow.
   *
   * Injected for the same reasons as the three above, and optional for the same
   * reason: nothing about capture depends on it existing.
   */
  updates?: { open: () => void };
  /**
   * Looks for a newer version, if nothing has looked recently.
   *
   * Called when the panel opens, which for a menu-bar app is the only regular
   * moment there is: the launch check is the only other one, and an instance
   * running since a fortnight ago has asked exactly once. Injected rather than
   * imported so the flow stays testable without Electron, like everything else
   * here — `main/update.ts` owns both the throttle and the decision to stay
   * quiet about what it finds.
   */
  checkForUpdates?: () => void;
}

export class CaptureFlow {
  private pending: PendingSelection | null = null;
  private selecting = false;
  private cameraError: string | null = null;
  private activeMode: ScreenMode | null = null;
  private refreshing = false;
  /**
   * Which selection is the current one.
   *
   * Choosing a mode while a picker is already up cancels the first, and that
   * cancellation resolves inside the *older* call — whose cleanup would
   * otherwise clear `selecting` for the picker that just replaced it.
   */
  private selectionRun = 0;

  constructor(private readonly deps: CaptureFlowOptions) {
    // The panel renders session state too, so it has to follow it.
    this.deps.session.subscribe(() => this.emit());

    // The bubble is draggable, so where the user put it is a preference like
    // any other — it just happens to be expressed by moving a window.
    this.deps.camera.restore(this.deps.preferences.get().cameraPosition);
    this.deps.camera.onMove((cameraPosition) => {
      this.deps.preferences.update({ cameraPosition });
    });

    this.syncCamera();
  }

  /** Where preferences are stored. */
  preferencesPath(): string {
    return this.deps.preferences.path;
  }

  /**
   * The welcome flow is finished: remember it, and get on with recording.
   *
   * The flag is written even when a permission was refused. It only answers
   * "has this been seen", and the window opens again on its own for as long as
   * Screen Recording is missing — so recording that fact twice would mean two
   * places to keep in step and one of them eventually wrong.
   */
  finishWelcome(): void {
    // Fired here rather than off the flag, because this is the transition. The
    // flag is a state and is already true on every launch afterwards.
    track("welcome_completed");
    this.deps.preferences.update({ welcomed: true });
    this.deps.welcome?.close();
    this.open();
  }

  /** Opens settings, or focuses the window already open. */
  openSettings(): void {
    this.deps.settings?.open();
  }

  /** Opens the update window, or focuses the one already open. */
  openUpdate(): void {
    this.deps.updates?.open();
  }

  state(): DockState {
    const session = this.deps.session.snapshot();
    return {
      view: session.status === "idle" ? "setup" : ("recording" as DockView),
      preferences: this.deps.preferences.get(),
      activeMode: this.activeMode,
      selection: this.pending,
      session,
      selecting: this.selecting,
      cameraError: this.cameraError,
      // While the panel is up, or while a recording is running — and at no
      // other time. The devices belong to the setup UI and to the capture, and
      // holding them open past both is what leaves the camera light on with
      // nothing on screen to explain it.
      devicesLive: this.deps.dock.isVisible || session.status !== "idle",
    };
  }

  /**
   * Brings the panel back without opening a picker.
   *
   * Separate from `open` because closing the editor should return the user to
   * the panel, not drop a full-screen overlay over the screen they were just
   * looking at.
   */
  showDock(): void {
    // Read before `show`, because this is the transition: `showDock` is also how
    // the panel is brought back to the front while it is already up, and a check
    // per press is not what "when the panel opens" means.
    //
    // Only from idle. The panel comes back during a recording too — closing an
    // editor, a start that failed — and somebody who is mid-take is the last
    // person with any use for an update.
    const opening = !this.deps.dock.isVisible && this.deps.session.snapshot().status === "idle";

    this.deps.dock.show();
    this.syncCamera();
    this.emit();

    // After the panel is up and the state is out. Nothing here is awaited, so
    // the check cannot delay the window somebody just asked for.
    if (opening) this.deps.checkForUpdates?.();
  }

  open(): void {
    this.showDock();

    // Opening Prequel is only ever a prelude to choosing something to record,
    // so go straight to the picker for whichever mode was used last rather than
    // making the user ask for it again.
    void this.chooseMode(this.deps.preferences.get().mode).catch((cause) => {
      console.warn("[flow] could not open the picker:", cause);
    });
  }

  /** Opens a recording for editing, hiding the recorder's floating UI. */
  openEditor(dir: string): void {
    this.deps.workspace?.open(dir);
  }

  /** Opens the Projects grid, for the tray to reach through the flow. */
  openProjects(): void {
    this.deps.workspace?.open();
  }

  /**
   * The app window took over. The panel, the bubble and any picker get out of
   * the way — they exist to set up a recording, and the user is now looking at
   * one that is already made.
   */
  workspaceOpened(): void {
    this.deps.selection.cancel();
    this.deps.dock.hide();
    this.deps.camera.hide();
    // Emitted because hiding is exactly when the renderers have to be told to
    // let the devices go — without this they keep them for the whole session.
    this.emit();
  }

  /**
   * The app window closed, so the panel comes back.
   *
   * Only when the window was opened by a finished take. Somebody who opened the
   * grid from the tray to look through it and closed it again did not ask for a
   * picker over the screen they were just looking at.
   */
  workspaceClosed(fromCapture: boolean): void {
    if (!fromCapture) return;
    this.showDock();
  }

  toggle(): void {
    if (this.deps.dock.isVisible) this.close();
    else this.open();
  }

  updatePreferences(patch: Partial<RecordingPreferences>): DockState {
    // A different camera — or none — gets a clean slate: the old device's
    // failure says nothing about the new one.
    if ("cameraId" in patch) this.cameraError = null;
    this.deps.preferences.update(patch);
    // Emit before syncing so the bubble's renderer already has the new device
    // when its window appears.
    this.emit();
    this.syncCamera();
    return this.state();
  }

  /**
   * Records that the camera preview failed, or recovered.
   *
   * Reported by the bubble because it is the only part of the app that
   * actually opens the device: a camera can be listed and still refuse to
   * open, and the panel would otherwise show it as on.
   */
  reportCameraError(message: string | null): DockState {
    if (this.cameraError === message) return this.state();
    this.cameraError = message;
    this.emit();
    return this.state();
  }

  /** Sizes the panel to the width the renderer measured. */
  setPanelWidth(width: number): void {
    this.deps.dock.setContentWidth(width);
  }

  /** Makes room above the panel for a drop-up, or takes it back. */
  setMenuOpen(open: boolean): void {
    this.deps.dock.setMenuOpen(open);
  }

  /** Shows or hides the camera bubble to match the chosen device. */
  private syncCamera(): void {
    if (this.deps.preferences.get().cameraId) this.deps.camera.show();
    else this.deps.camera.hide();
  }

  /**
   * Switches capture mode and opens the overlay for it.
   *
   * Every mode gets one, including "entire screen": it is what shows the
   * outline of exactly what will be recorded, at what resolution, before any
   * of it is committed — and on a second monitor it is the only way to say
   * which screen, rather than silently taking whichever one the cursor was on.
   */
  async chooseMode(mode: ScreenMode): Promise<DockState> {
    log("info", "choosing a source", { mode });
    this.deps.preferences.update({ mode });

    // The overlay covers the panel, so drop the stale selection first —
    // otherwise cancelling leaves the panel claiming a target from the old mode.
    const run = ++this.selectionRun;
    this.pending = null;
    this.activeMode = mode;
    this.selecting = true;
    this.emit();

    let start = false;
    // Only the window picker describes things that move underneath it; a
    // display's geometry and a dragged region do not change while it is up.
    const refresh =
      mode === "window" ? setInterval(() => void this.refreshTargets(), WINDOW_REFRESH_MS) : null;

    try {
      const targets = await (await getRecorder()).listTargets();
      const result = await this.deps.selection.open(
        mode,
        targets,
        mode === "window" ? await windowIcons(targets) : undefined,
      );
      // Every outcome of the overlay, named. A cancel and a confirm look the
      // same from outside — the overlay disappears either way — and only one of
      // them goes on to record.
      log("info", "selection closed", {
        mode,
        outcome: result ? (result.start === true ? "record" : "chosen") : "cancelled",
        crop: result?.crop
          ? `${String(Math.round(result.crop.width))}×${String(Math.round(result.crop.height))}`
          : "none",
      });

      if (result) {
        this.pending = { mode, target: result.target, crop: result.crop, label: result.label };
        start = result.start === true;
      } else if (run === this.selectionRun) {
        // Cancelled. Nothing is chosen, so nothing should look chosen — and the
        // next attempt has to be asked for, rather than the panel sitting there
        // implying a source it does not have.
        this.activeMode = null;
        // Escape during the countdown is the common way here, and by then the
        // camera is open with its light on.
        this.releaseCamera();
      }
    } finally {
      if (refresh) clearInterval(refresh);
      // Only the newest selection owns the flag. An older one finishing later —
      // because a newer one cancelled it — must not report that nothing is
      // being chosen while its replacement is still on screen.
      if (run === this.selectionRun) {
        this.selecting = false;
        this.emit();
      }
    }

    // Likewise: a cancelled run must not go on to record or to overwrite the
    // newer selection's answer.
    if (run !== this.selectionRun) {
      log("info", "selection superseded; not recording", {
        run,
        current: this.selectionRun,
      });
      this.releaseCamera();
      return this.state();
    }

    // After `selecting` has been cleared, or `record` would start against a
    // panel that still believes an overlay is up.
    if (start) return this.record();

    // A source was chosen without starting, so the countdown never ran to a
    // recording. Anything it opened is stray.
    this.releaseCamera();
    return this.state();
  }

  /**
   * Pushes a fresh window list to an open picker.
   *
   * Skipped while a previous refresh is still in flight: listing is fast but
   * not instant, and queueing them up would make the picker lag further and
   * further behind the screen it is describing.
   */
  private async refreshTargets(): Promise<void> {
    if (this.refreshing || !this.deps.selection.isOpen) return;
    this.refreshing = true;

    try {
      const targets = await (await getRecorder()).listTargets();
      // Checked again: the overlay can close while the list is being read.
      if (!this.deps.selection.isOpen) return;
      this.deps.selection.update(targets, await windowIcons(targets));
    } catch (cause) {
      // A failed refresh just leaves the previous list up.
      console.warn("[picker] could not refresh windows:", cause);
    } finally {
      this.refreshing = false;
    }
  }

  /** Starts recording whatever the panel is set up to capture. */
  async record(): Promise<DockState> {
    // Every way out of this method that is not a recording says so. A record
    // button that silently does nothing is indistinguishable from a broken
    // one, and the difference is only visible in here.
    if (this.deps.session.isBusy()) {
      log("warn", "record ignored: a session is already busy", {
        status: this.deps.session.snapshot().status,
      });
      return this.state();
    }

    // Nothing chosen yet — fall back to the display the cursor is on rather
    // than making the user go and pick before they can press Record.
    const selection =
      this.pending ??
      ({
        mode: "screen",
        target: screenTargetFor(screen.getDisplayNearestPoint(screen.getCursorScreenPoint())),
        crop: null,
        label: "Entire screen",
      } satisfies PendingSelection);

    const preferences = this.deps.preferences.get();
    // Created before capture starts so its id exists to be excluded; showing it
    // afterwards would put the panel in the first frames of the video.
    const dock = this.deps.dock.prepare();
    // Prepared even when hidden: a window created after capture starts cannot
    // be excluded, and the user may switch the camera on mid-recording.
    const camera = this.deps.camera.prepare();

    log("info", "starting capture", {
      target: `${selection.target.kind} ${String(selection.target.id)}`,
      crop: selection.crop
        ? `${String(Math.round(selection.crop.width))}×${String(Math.round(selection.crop.height))}` +
          ` at ${String(Math.round(selection.crop.x))},${String(Math.round(selection.crop.y))}`
        : "none",
      bounds:
        `${String(Math.round(selection.target.bounds.width))}×` +
        `${String(Math.round(selection.target.bounds.height))}`,
    });

    // Shapes and switches only. The target's label names a window, which names
    // whatever the user happened to have open.
    track("recording_started", {
      mode: selection.mode,
      target: selection.target.kind,
      cropped: selection.crop !== null,
      camera: preferences.cameraId !== null,
      microphone: preferences.micId !== null,
      system_audio: preferences.systemAudio,
      bake_cursor: preferences.bakeCursor,
      countdown: preferences.countdown,
    });

    try {
      await this.deps.session.start({
        target: selection.target,
        crop: selection.crop,
        showCursor: preferences.bakeCursor,
        systemAudio: preferences.systemAudio,
        microphone: preferences.micId !== null,
        // The bubble is only a preview; this is what writes `camera.mp4`.
        camera: preferences.cameraId ? await this.nativeCameraId(preferences.cameraLabel) : null,
        excludedWindowIds: this.excludedIds([dock, camera]),
      });
    } catch (cause) {
      // Said out loud, and the panel put back. A start that fails silently
      // leaves the app looking like it ignored the button — which is
      // indistinguishable from a bug in the button.
      console.error("[flow] could not start capturing:", cause);
      this.releaseCamera();
      this.deps.dock.setView("setup");
      this.deps.dock.show();
      this.emit();
      throw cause;
    }

    this.deps.dock.setView("recording");
    this.deps.dock.show();
    this.emit();
    return this.state();
  }

  /** Pauses or resumes, whichever applies. */
  async togglePause(): Promise<void> {
    await this.deps.session.togglePause();
    this.emit();
  }

  close(): void {
    // Dismissing the panel dismisses the picker with it; leaving an overlay
    // covering the screen with nothing to drive it would be a trap.
    this.deps.selection.cancel();
    this.deps.dock.hide();
    this.deps.camera.hide();
    this.emit();
  }

  async stop(): Promise<void> {
    // Read before the stop clears it. `RecordingSession.stop()` resets the clock
    // in its `finally`, so asking afterwards reports zero for every recording
    // ever made — which looks like data rather than like a bug.
    const elapsedMs = this.deps.session.snapshot().elapsedMs;

    await this.deps.session.stop();
    this.deps.dock.setView("setup");
    this.emit();

    track("recording_stopped", { duration_ms: Math.round(elapsedMs) });

    // The take is on disk and nothing else in the app would ever show it, so
    // stopping opens the editor on it. Read from the session rather than
    // remembered here, because a stop that failed leaves no result and must not
    // open an editor onto a directory that has no manifest in it.
    const finished = this.deps.session.snapshot().lastResult;
    if (!finished) return;

    try {
      this.openEditor(finished.outputPath);
    } catch (cause) {
      // The recording itself is safe on disk; failing to open an editor for it
      // is not worth surfacing as a failed stop.
      console.warn("[flow] could not open the editor:", cause);
    }
  }

  /**
   * Stops the recording and deletes it, without opening an editor.
   *
   * The path is read *before* stopping. `RecordingSession.stop()` clears
   * `outputPath` in its `finally`, so reading it afterwards gives null on the
   * happy path and there would be nothing to delete — and a stop that threw
   * leaves no `lastResult` either, which is exactly the case where a
   * half-written directory most needs removing.
   *
   * Stop has to complete first regardless: the recorder still holds the files
   * open, and deleting underneath it leaves the writer failing into a directory
   * that is no longer there.
   */
  async discard(): Promise<void> {
    const { outputPath: path, elapsedMs } = this.deps.session.snapshot();

    track("recording_discarded", { duration_ms: Math.round(elapsedMs) });

    await this.deps.session.stop();
    this.deps.session.forgetLastResult();
    this.deps.dock.setView("setup");
    this.emit();

    if (!path) return;
    if (deleteRecording(path)) log("info", "recording discarded");
  }

  /** Stops if recording, otherwise opens the panel ready to start. */
  async toggleRecording(): Promise<void> {
    if (this.deps.session.isBusy()) {
      await this.stop();
      return;
    }
    if (this.deps.selection.isOpen) {
      this.deps.selection.cancel();
      return;
    }
    this.open();
  }

  cancelSelection(): void {
    this.deps.selection.cancel();
  }

  /**
   * Opens the camera while the countdown is on screen.
   *
   * Three seconds of warm-up that were being spent anyway. An
   * `AVCaptureSession` calls itself running as soon as the pipeline is live,
   * which is well before the sensor has settled on an exposure — so a camera
   * opened at the instant recording starts writes a dark second or two first.
   *
   * Deliberately not awaited by the caller and never throws: this is an
   * optimisation, and a camera that will not open early is one `record` opens
   * itself, with the dark head it always had. Paired with `releaseCamera` on
   * every path that does not reach a recording, because the camera light comes
   * on here.
   */
  async warmCamera(): Promise<void> {
    const preferences = this.deps.preferences.get();
    if (!preferences.cameraId) return;

    try {
      const device = await this.nativeCameraId(preferences.cameraLabel);
      if (!device) return;
      await (await getRecorder()).prepareCamera(device);
    } catch (cause) {
      console.warn("[flow] could not open the camera early:", cause);
    }
  }

  /**
   * Closes a camera opened by `warmCamera`.
   *
   * Safe to call when nothing is open, which is why every path out of a
   * countdown calls it rather than working out whether it needs to. The cost of
   * missing one is the camera light left on with nothing recording.
   */
  private releaseCamera(): void {
    void (async () => {
      try {
        (await getRecorder()).releaseCamera();
      } catch (cause) {
        console.warn("[flow] could not close the early camera:", cause);
      }
    })();
  }

  chooseSelection(result: Parameters<SelectionOverlay["choose"]>[0]): void {
    this.deps.selection.choose(result);
  }

  private emit(): void {
    this.deps.onChange(this.state());
  }

  /**
   * Resolves the panel's camera label to an AVFoundation device.
   *
   * Returns null when nothing matches, and records why. Recording the screen
   * without the bubble beats refusing to record at all — the take is the part
   * that cannot be redone.
   */
  private async nativeCameraId(label: string | null): Promise<string | null> {
    if (!label) return null;

    const cameras = (await getRecorder()).listCameras();
    const match = matchCamera(label, cameras);
    if (match) return match.id;

    this.cameraError = `${label} is not available to record`;
    return null;
  }

  /**
   * `CGWindowID`s of every window of ours that could be on screen.
   *
   * `setContentProtection(true)` is not an option: it sets
   * `NSWindowSharingNone`, which ScreenCaptureKit deliberately ignores on
   * current macOS. Passing ids into the content filter is the only mechanism
   * that actually removes our UI from the recording.
   */
  private excludedIds(extra: BrowserWindow[]): number[] {
    const ids = new Set<number>();
    for (const window of [...extra, ...this.deps.selection.browserWindows()]) {
      if (!window || window.isDestroyed()) continue;
      const id = windowId(window);
      if (id !== null) ids.add(id);
    }
    return [...ids];
  }
}
