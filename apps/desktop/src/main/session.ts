/**
 * Owns the app-wide recording lifecycle.
 *
 * Recording can be triggered from several places at once — the tray menu, the
 * popover, a global hotkey, the floating pill — so the decision of what a
 * command means lives here rather than in any one of them. Everything else
 * observes and reacts.
 */
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

import { shell } from "electron";

import type { SessionState, SessionStatus, StartOptions, Target } from "../shared/contract.js";
import type { Recorder, RecordingResult, StartRecordingRequest } from "./recorder.js";
import { log } from "./log.js";
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

/**
 * Where a take's own files live: the tracks, both manifests, the pointer images
 * and whatever background was chosen.
 *
 * A dot-directory, and that is the whole point. What the user came to this
 * folder for is the export; everything else is working state that happens to be
 * on disk. Before this, opening a recording meant twenty-two items — four
 * pointer PNGs, one JPEG for every background that had ever been *previewed*,
 * two manifests and the raw tracks — with the finished video somewhere among
 * them. Five orphaned `cursor-black*` files from a renamed style set were still
 * sitting in takes made months later, because nothing ever had a reason to
 * remove them.
 *
 * Hidden rather than deleted: a recording still carries everything it needs to
 * be re-exported on another machine, which is the property the copying exists
 * for. It just stops being the first thing anyone sees.
 */
const SESSIONS_DIR = join(RECORDINGS_DIR, ".recordings");

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

  /**
   * Forgets the last finished take.
   *
   * `stop()` records a result so the flow can open an editor on it. A discarded
   * take must not leave one behind: the directory is gone, and anything that
   * later reached for `lastResult` would open an editor onto nothing.
   */
  forgetLastResult(): void {
    this.lastResult = null;
    this.emit();
  }

  async start(options: StartOptions): Promise<void> {
    if (this.status !== "idle") {
      // Said out loud. A start that returns quietly because the session is in
      // some other state looks exactly like a button that does nothing.
      log("warn", `start ignored: session is ${this.status}, not idle`);
      return;
    }

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
export function newRecordingPath(now = new Date(), dir = SESSIONS_DIR): string {
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
 * Deletes a take, permanently.
 *
 * Guarded to the recordings directory, and to a directory rather than a file.
 * Nothing should ever hand this an arbitrary path — but this is a recursive
 * delete reached from a button, and the cost of being sure is one comparison.
 *
 * Not `shell.trashItem`: a discarded take is meant to reclaim the disk, which
 * a 4K recording makes worth caring about.
 */
export function deleteRecording(path: string, dir = SESSIONS_DIR): boolean {
  if (!insideRecordings(path, dir)) {
    console.warn(`[library] refusing to delete outside the recordings folder: ${path}`);
    return false;
  }

  const resolved = resolve(path);
  try {
    rmSync(resolved, { recursive: true, force: true });
    return true;
  } catch (cause) {
    console.warn(`[library] could not delete ${resolved}:`, cause);
    return false;
  }
}

/**
 * Whether a path is a recording inside the library, rather than anything else.
 *
 * Every path that reaches the library from a renderer goes through here first.
 * The renderer is the least-trusted process in the app and these operations
 * delete, overwrite and rename — the same posture `media-protocol.ts` takes for
 * reads, for the same reason.
 */
export function insideRecordings(path: string, dir = SESSIONS_DIR): boolean {
  const resolved = resolve(path);
  const root = resolve(dir);

  // `startsWith(root)` alone would also accept a sibling whose name merely
  // begins with the root's, so the separator has to be part of the test. The
  // root itself is not a recording either.
  return resolved !== root && resolved.startsWith(root + sep);
}

export { RECORDINGS_DIR, SESSIONS_DIR };
