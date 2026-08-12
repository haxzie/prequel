/**
 * Running one export at a time, and telling the editor how it is going.
 *
 * The heavy lifting is in `prequel-render`; this owns the job's lifecycle, so
 * that a second Export press cannot start a competing render and a closed
 * window cannot leave one running with nobody listening.
 */
import { join } from "node:path";

import { webContents } from "electron";

import type { ExportProgress, ExportRequest } from "../shared/contract.js";
import { IPC_CHANNELS } from "../shared/contract.js";
import { log } from "./log.js";
import { getRecorder } from "./recorder.js";
import { fileTimestamp, revealRecordings } from "./session.js";

/**
 * What one export is called inside its recording's own folder.
 *
 * Timestamped rather than a fixed `export.mp4`: exporting twice is normal —
 * a different frame size, a tweaked background — and a fixed name would either
 * silently destroy the previous attempt or, worse, collide with it. Both
 * exports simply sit side by side, newest last.
 */
export function exportFileName(now = new Date()): string {
  return `Export ${fileTimestamp(now)}.mp4`;
}

/** The directory currently being exported, or null. */
let running: string | null = null;

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

  const output = join(request.dir, exportFileName());
  running = request.dir;

  log("info", "export started", {
    dir: request.dir,
    frame: `${request.width}×${request.height}`,
    fps: request.fps,
    codec: request.codec,
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
        codec: request.codec,
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

/** Asks the running export to stop. Safe to call when nothing is running. */
export async function cancelExport(): Promise<void> {
  if (!running) return;
  (await getRecorder()).cancelExport();
}

function finish(update: ExportProgress): void {
  running = null;

  // Logged here rather than only shown in the editor: a failed export is the
  // one thing a user cannot investigate for themselves, and the message the
  // renderer displays is gone as soon as the window closes.
  if (update.stage === "failed") {
    console.error(`export failed: ${update.error?.message ?? "no reason given"}`);
  } else {
    log("info", `export ${update.stage}`, update.outputPath ?? undefined);
  }

  broadcast(update);

  // Revealed rather than opened: the file is the thing the user wants, and
  // showing it in place also shows them where their recordings live.
  if (update.stage === "done" && update.outputPath) {
    void revealRecordings(update.outputPath);
  }
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
