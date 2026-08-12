/**
 * Owns the app-wide recording lifecycle.
 *
 * Recording can be triggered from several places at once — the tray menu, the
 * popover, a global hotkey, the floating pill — so the decision of what a
 * command means lives here rather than in any one of them. Everything else
 * observes and reacts.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { shell } from "electron";

import type {
  RecentRecording,
  SessionState,
  SessionStatus,
  StartOptions,
  Target,
} from "../shared/contract.js";
import { MANIFEST_FILE_NAME } from "../shared/manifest.js";
import type { Recorder, RecordingResult, StartRecordingRequest } from "./recorder.js";
import { describeRecorderError, getRecorder } from "./recorder.js";

export type { SessionState, SessionStatus, StartOptions };

type Listener = (state: SessionState) => void;

/**
 * Where recordings are written.
 *
 * Overridable so tests and end-to-end runs write to a scratch directory
 * instead of the user's real Movies folder.
 */
const RECORDINGS_DIR =
  process.env["PREQUEL_RECORDINGS_DIR"] ?? join(homedir(), "Movies", "Prequel");

export class RecordingSession {
  private status: SessionStatus = "idle";
  private target: Target | null = null;
  private outputPath: string | null = null;
  private error: SessionState["error"] = null;
  private lastResult: SessionState["lastResult"] = null;
  private excludedWindowIds: number[] = [];
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly load: () => Promise<Recorder> = getRecorder) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): SessionState {
    return {
      status: this.status,
      target: this.target,
      elapsedMs: this.elapsedMs(),
      outputPath: this.outputPath,
      error: this.error,
      lastResult: this.lastResult,
      excludedWindowIds: this.excludedWindowIds,
    };
  }

  isBusy(): boolean {
    return this.status !== "idle";
  }

  async start(options: StartOptions): Promise<void> {
    if (this.status !== "idle") return;

    this.status = "starting";
    this.error = null;
    this.lastResult = null;
    this.emit();

    const outputPath = newRecordingPath();
    const request: StartRecordingRequest = {
      targetKind: options.target.kind,
      targetId: options.target.id,
      bounds: options.target.bounds,
      scaleFactor: options.target.scaleFactor,
      crop: options.crop ?? undefined,
      outputPath,
      fps: options.fps ?? 60,
      // Off by default: the pointer is sampled and drawn by the editor,
      // and baking it into the frames cannot be undone.
      showCursor: options.showCursor ?? false,
      systemAudio: options.systemAudio ?? false,
      microphone: options.microphone ?? false,
      camera: options.camera ?? undefined,
      startedAt: new Date().toISOString(),
      excludedWindowIds: options.excludedWindowIds ?? [],
    };

    try {
      const recorder = await this.load();
      await recorder.startRecording(request);
    } catch (cause) {
      // Reset fully: a failed start must not leave the app looking armed.
      this.status = "idle";
      this.target = null;
      this.outputPath = null;
      this.error = describeRecorderError(cause);
      this.emit();
      throw cause;
    }

    this.status = "recording";
    this.target = options.target;
    this.excludedWindowIds = request.excludedWindowIds ?? [];
    this.outputPath = outputPath;
    this.startedAt = Date.now();
    this.pausedTotal = 0;
    this.emit();
  }

  async pause(): Promise<void> {
    if (this.status !== "recording") return;
    (await this.load()).pauseRecording();
    this.pausedAt = Date.now();
    this.status = "paused";
    this.emit();
  }

  async resume(): Promise<void> {
    if (this.status !== "paused") return;
    (await this.load()).resumeRecording();
    this.pausedTotal += Date.now() - this.pausedAt;
    this.status = "recording";
    this.emit();
  }

  /** Pauses or resumes, whichever applies. */
  async togglePause(): Promise<void> {
    if (this.status === "recording") return this.pause();
    if (this.status === "paused") return this.resume();
  }

  async stop(): Promise<RecordingResult | null> {
    if (this.status !== "recording" && this.status !== "paused") return null;

    if (this.status === "paused") this.pausedTotal += Date.now() - this.pausedAt;
    this.status = "stopping";
    this.emit();

    const outputPath = this.outputPath;
    try {
      const result = await (await this.load()).stopRecording();
      this.lastResult = outputPath ? { ...result, outputPath } : null;
      return result;
    } catch (cause) {
      this.error = describeRecorderError(cause);
      return null;
    } finally {
      this.status = "idle";
      this.target = null;
      this.outputPath = null;
      this.excludedWindowIds = [];
      this.emit();
    }
  }

  /** Starts if idle, stops if recording — what a single hotkey should do. */
  async toggle(options: StartOptions): Promise<void> {
    if (this.status === "idle") {
      await this.start(options);
    } else {
      await this.stop();
    }
  }

  private elapsedMs(): number {
    if (this.status === "idle" || this.status === "starting") return 0;
    const paused =
      this.status === "paused" ? this.pausedTotal + (Date.now() - this.pausedAt) : this.pausedTotal;
    return Math.max(0, Date.now() - this.startedAt - paused);
  }

  private emit(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }
}

/**
 * A directory for one recording's tracks.
 *
 * A session is several files — screen, camera, microphone, system audio — so
 * the output is a folder rather than a single video. Keeping them together is
 * what makes the set reassemblable later.
 */
export function newRecordingPath(now = new Date(), dir = RECORDINGS_DIR): string {
  mkdirSync(dir, { recursive: true });
  return join(dir, `Prequel ${fileTimestamp(now)}`);
}

/**
 * A timestamp safe to put in a file name: `2026-08-11 12-30-00`.
 *
 * Shared by recordings and exports so the two sort together in Finder. Colons
 * are legal on APFS but confuse shells and Finder's quick actions, so they are
 * dashes here.
 */
export function fileTimestamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-").replace("T", " ").slice(0, 19);
}

/**
 * Reveals a recording, or the recordings folder, in Finder.
 *
 * The folder is created first: `shell.openPath` fails silently on a path that
 * does not exist, so before the first recording the menu item would appear to
 * do nothing at all.
 */
export async function revealRecordings(path?: string): Promise<void> {
  if (path) {
    shell.showItemInFolder(path);
    return;
  }
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const error = await shell.openPath(RECORDINGS_DIR);
  if (error) console.warn(`[library] could not open ${RECORDINGS_DIR}: ${error}`);
}

/**
 * Past recordings, newest first.
 *
 * A directory only counts if it holds a manifest: an interrupted take can leave
 * a folder with a half-written screen track and nothing describing it, and
 * offering that as something to open would only produce an error on click.
 *
 * Sorted by the manifest's own mtime rather than the directory's, which macOS
 * touches for reasons that have nothing to do with when the take was made.
 */
export function recentRecordings(limit = 10, dir = RECORDINGS_DIR): RecentRecording[] {
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (cause) {
    console.warn(`[library] could not read ${dir}:`, cause);
    return [];
  }

  const recordings: RecentRecording[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    try {
      recordings.push({
        dir: path,
        name,
        modifiedAt: statSync(join(path, MANIFEST_FILE_NAME)).mtimeMs,
      });
    } catch {
      // No manifest, or unreadable. Not a recording we can open.
    }
  }

  return recordings.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
}

export { RECORDINGS_DIR };
