/**
 * Running one export at a time, and telling the editor how it is going.
 *
 * The heavy lifting is in `prequel-render`; this owns the job's lifecycle, so
 * that a second Export press cannot start a competing render and a closed
 * window cannot leave one running with nobody listening.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { clipboard, nativeImage, webContents, type WebContents } from "electron";

import type { ExportFormat, ExportProgress, ExportRequest } from "../shared/contract.js";
import { IPC_CHANNELS } from "../shared/contract.js";
import { track } from "./analytics.js";
import { log } from "./log.js";
import { getRecorder } from "./recorder.js";
import { RECORDINGS_DIR, fileTimestamp } from "./session.js";

/**
 * What one export is called inside its recording's own folder.
 *
 * Timestamped rather than a fixed `export.mp4`: exporting twice is normal —
 * a different frame size, a tweaked background — and a fixed name would either
 * silently destroy the previous attempt or, worse, collide with it. Both
 * exports simply sit side by side, newest last.
 *
 * The extension is worked out here and nowhere else. Two places deciding it is
 * how an export comes to be written as a GIF into a file called `.mp4`, which
 * nothing on the system will open.
 */
export function exportFileName(format: ExportFormat, now = new Date()): string {
  return `Export ${fileTimestamp(now)}.${format === "gif" ? "gif" : "mp4"}`;
}

/** The directory currently being exported, or null. */
let running: string | null = null;

/**
 * When the export in progress started, for the event that reports it finishing.
 *
 * How long a render actually takes on real machines is the number that decides
 * whether the encoder is worth work, and it is not knowable from anywhere else —
 * a packaged app has no console and the log only records the stages.
 */
let startedAt = 0;

export function isExporting(): boolean {
  return running !== null;
}

/**
 * Starts an export.
 *
 * Rejects a second one rather than queueing: there is one GPU and one encoder,
 * and two concurrent renders would fight over both while making each other
 * slower.
 */
export async function startExport(request: ExportRequest): Promise<void> {
  if (running) {
    throw new Error("ALREADY_EXPORTING: an export is already running");
  }

  // Beside the recordings, not inside the take. A take's directory is working
  // state — tracks, manifests, the pointer images — and burying the one file
  // the user actually wants among them is what made this folder unusable.
  const output = join(RECORDINGS_DIR, exportFileName(request.format));
  running = request.dir;
  startedAt = Date.now();

  track("export_started", {
    format: request.format,
    width: request.width,
    height: request.height,
    fps: request.fps,
    slices: request.slices.length,
  });

  log("info", "export started", {
    dir: request.dir,
    frame: `${request.width}×${request.height}`,
    fps: request.fps,
    format: request.format,
    slices: request.slices.length,
  });

  try {
    const recorder = await getRecorder();

    recorder.startExport(
      {
        sessionDir: request.dir,
        output,
        width: request.width,
        height: request.height,
        fps: request.fps,
        format: request.format,
        slices: request.slices.map((slice) => ({
          start: slice.start,
          end: slice.end,
          // Serialised rather than passed structurally: the plan is a
          // discriminated union several levels deep, and JSON is the one
          // representation both sides already agree on.
          plan: JSON.stringify(slice.plan),
          micVolume: slice.micVolume,
          systemVolume: slice.systemVolume,
        })),
        screenOffset: request.offsets.screen,
        cameraOffset: request.offsets.camera,
        micOffset: request.offsets.microphone,
        systemOffset: request.offsets.system_audio,
      },
      (error, progress) => {
        if (error) {
          finish({
            stage: "failed",
            framesDone: 0,
            framesTotal: 0,
            outputPath: null,
            error: { code: null, message: error.message },
          });
          return;
        }

        const update: ExportProgress = {
          stage: progress.stage as ExportProgress["stage"],
          framesDone: progress.framesDone,
          framesTotal: progress.framesTotal,
          outputPath: progress.outputPath ?? null,
          error: progress.message ? { code: null, message: progress.message } : null,
        };

        if (update.stage === "done" || update.stage === "failed" || update.stage === "cancelled") {
          finish(update);
          return;
        }

        broadcast(update);
      },
    );
  } catch (cause) {
    running = null;
    throw cause;
  }
}

/**
 * Puts a finished export on the pasteboard as a *file*.
 *
 * `public.file-url` rather than `clipboard.writeText`. macOS decides what a
 * paste means from the pasteboard type: text pastes the path as characters, so
 * Slack gets `/Users/…/Export 2026-08-17.mp4` written out as a message and
 * Finder gets nothing at all. This is the type Finder itself writes on Copy,
 * and Electron has no file-list API of its own — hence the raw buffer.
 */
export function copyExport(path: string): void {
  clipboard.writeBuffer("public.file-url", Buffer.from(pathToFileURL(path).toString(), "utf8"));
  log("info", "export copied to the pasteboard", path);
}

/**
 * Hands a finished export to a native drag.
 *
 * The icon is not optional — Electron throws on an empty one — and it is also
 * the whole point: what gets dragged is a file, and a drag with no image under
 * the pointer reads as nothing having been picked up. The renderer sends the
 * frame it is already showing, so the thing being dragged looks like the thing
 * on screen.
 */
export function dragExport(sender: WebContents, path: string, icon: string): void {
  const image = nativeImage.createFromDataURL(icon);
  if (image.isEmpty()) {
    console.warn("[export] drag skipped: the drag image could not be read");
    return;
  }

  // Scaled down here rather than in the renderer: the preview is whatever size
  // the pane happened to be, and a full-size frame under the pointer covers the
  // window the user is trying to drop onto.
  sender.startDrag({ file: path, icon: image.resize({ width: 160 }) });
}

/** Asks the running export to stop. Safe to call when nothing is running. */
export async function cancelExport(): Promise<void> {
  if (!running) return;
  (await getRecorder()).cancelExport();
}

function finish(update: ExportProgress): void {
  running = null;

  track(`export_${update.stage}`, {
    took_ms: startedAt ? Date.now() - startedAt : null,
    frames: update.framesTotal,
    // The message, not the path. A failure reason is a bug report; a path is
    // the user's home directory and the name of whatever they recorded.
    ...(update.stage === "failed" ? { message: update.error?.message ?? null } : {}),
  });

  // Logged here rather than only shown in the editor: a failed export is the
  // one thing a user cannot investigate for themselves, and the message the
  // renderer displays is gone as soon as the window closes.
  if (update.stage === "failed") {
    console.error(`export failed: ${update.error?.message ?? "no reason given"}`);
  } else {
    log("info", `export ${update.stage}`, update.outputPath ?? undefined);
  }

  // Nothing is revealed here. The export dialog offers Show in Finder beside
  // the finished file, and opening Finder on its own used to pull focus out of
  // the editor the moment a render finished — often minutes after the user had
  // moved on to something else.
  broadcast(update);
}

/**
 * Pushes progress to every live renderer.
 *
 * Broadcast rather than sent to one window, matching how panel state already
 * travels — and the editor that started the export is not necessarily the only
 * thing that should know it finished.
 */
function broadcast(progress: ExportProgress): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.exportProgress, progress);
  }
}
