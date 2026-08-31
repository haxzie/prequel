/**
 * Facade over the native recorder addon.
 *
 * Everything in the main process talks to recording through this interface
 * rather than importing `@prequel/recorder` directly, so tests can substitute a
 * fake and end-to-end runs can avoid touching ScreenCaptureKit — and therefore
 * TCC — altogether.
 */
import type {
  ExportOptions,
  ExportProgress as NativeExportProgress,
  RecordingResult,
  RecordingState,
  SpeechAvailability,
  TrackProbe,
  TranscribeOptions,
  TranscribeUpdate,
} from "@prequel/recorder";

import type { PermissionStatus, Target, TargetKind } from "../shared/contract.js";

export type {
  ExportOptions,
  NativeExportProgress,
  PermissionStatus,
  RecordingResult,
  RecordingState,
  SpeechAvailability,
  Target,
  TrackProbe,
  TranscribeOptions,
  TranscribeUpdate,
};

/**
 * What the addon needs to begin a recording.
 *
 * Mirrors the addon's generated `RecordRequest` but uses the app's plain string
 * unions. The single `as unknown as Recorder` cast in `getRecorder` is where
 * the two representations meet — they are runtime-identical.
 */
/** A camera as AVFoundation names it, which is not how Chromium names it. */
export interface NativeCamera {
  /** `AVCaptureDevice.uniqueID`. */
  id: string;
  /** `AVCaptureDevice.localizedName`. */
  name: string;
}

export interface StartRecordingRequest {
  targetKind: TargetKind;
  targetId: number;
  /** Target geometry in points, as already measured by the shell. */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  /** Directory the session's tracks are written into. */
  outputPath: string;
  fps?: number;
  /** `"h264"` or `"hevc"`. */
  codec?: string;
  showCursor?: boolean;
  /** Sub-region of the target to capture, in points relative to its origin. */
  crop?: { x: number; y: number; width: number; height: number };
  systemAudio?: boolean;
  microphone?: boolean;
  /**
   * Camera to record as a fourth track, by `uniqueID` or exact
   * `localizedName`. Omit to record no camera.
   */
  camera?: string;
  /**
   * Wall-clock start as an ISO 8601 string, recorded in the manifest.
   *
   * For display only — synchronisation is answered by the per-track offsets,
   * which are on the session clock rather than the wall clock.
   */
  startedAt?: string;
  /**
   * `CGWindowID`s to keep out of the recording.
   *
   * Electron's `setContentProtection(true)` does *not* hide a window from
   * ScreenCaptureKit on current macOS, so this is the only mechanism that
   * works. Read the ids from `BrowserWindow.getMediaSourceId()`.
   */
  excludedWindowIds?: number[];
}

export interface Recorder {
  /** Current Screen Recording grant. Does not prompt. */
  screenAccessStatus(): PermissionStatus;
  /** Shows the macOS Screen Recording prompt. Only ever fires once per app. */
  requestScreenAccess(): PermissionStatus;
  /** Displays and on-screen windows available to record. */
  listTargets(): Promise<Target[]>;
  /** Cameras as AVFoundation sees them. Does not prompt or open anything. */
  listCameras(): NativeCamera[];

  /**
   * Opens a camera before there is anything to record with it.
   *
   * Called when the countdown appears, so the sensor has settled on an exposure
   * by the time the first frame is written — a camera opened at the instant
   * recording starts spends its first second or two dark. Turns the camera
   * light on, so it is paired with `releaseCamera` on every path that does not
   * reach a recording.
   *
   * Never fatal: `startRecording` opens the camera itself if this was not
   * called, failed, or was called for a camera the user then changed.
   */
  prepareCamera(device: string): Promise<void>;
  /** Closes a camera opened by `prepareCamera`, if one is still open. */
  releaseCamera(): void;

  startRecording(request: StartRecordingRequest): Promise<void>;
  stopRecording(): Promise<RecordingResult>;
  pauseRecording(): void;
  resumeRecording(): void;
  recordingState(): RecordingState;

  /**
   * Reads back what a finished session's files actually contain.
   *
   * The manifest describes what the recorder believed it wrote; this is the
   * media's own account of its dimensions and duration. Tracks whose files are
   * absent are simply omitted — a silent microphone writes no file, and that is
   * a normal recording.
   */
  probeSession(dir: string): Promise<TrackProbe[]>;

  /**
   * Screenshots the current desktop picture to `path`, as a PNG.
   *
   * `displayId` of 0 means the main display. A screenshot rather than a file
   * lookup because macOS 14+ does not reliably name the wallpaper file, and a
   * dynamic or video wallpaper has no still image to name.
   */
  captureWallpaper(displayId: number, path: string): Promise<void>;

  /**
   * Renders an edit to a single MP4.
   *
   * Returns immediately; progress arrives on the callback, and completion is a
   * terminal progress event rather than a resolved promise — one channel means
   * "done" cannot overtake the tick before it.
   */
  startExport(
    options: ExportOptions,
    onProgress: (error: Error | null, progress: NativeExportProgress) => void,
  ): void;

  /** Asks the running export to stop. Safe when nothing is running. */
  cancelExport(): void;

  /**
   * What macOS can transcribe here, without asking anyone for permission.
   *
   * Cheap and prompt-free on purpose: the editor calls it to decide whether to
   * offer captions at all, and a TCC dialog nobody asked for is worse than a
   * button that says it cannot.
   */
  speechAvailability(locale: string): SpeechAvailability;

  /**
   * Starts an on-device transcription. Same shape as `startExport`, and for the
   * same reasons — a long job on its own thread, with completion arriving as a
   * terminal update rather than a resolved promise.
   */
  startTranscribe(
    options: TranscribeOptions,
    onProgress: (error: Error | null, update: TranscribeUpdate) => void,
  ): void;

  /** Asks the running transcription to stop. Safe when nothing is running. */
  cancelTranscribe(): void;

  /**
   * Points the native side's diagnostics at the app's log file.
   *
   * Every Rust crate here logs through `tracing`, which discards everything
   * unless a subscriber is installed — so without this a skipped background or
   * an unreadable track is reported to nobody.
   */
  setLogFile(path: string): void;
}

/** Error codes the native layer prefixes onto its messages. */
export const RecorderErrorCode = {
  ScreenAccessDenied: "SCREEN_ACCESS_DENIED",
  Timeout: "TIMEOUT",
  DisplayNotFound: "DISPLAY_NOT_FOUND",
  DisplayAsleep: "DISPLAY_ASLEEP",
  WindowNotFound: "WINDOW_NOT_FOUND",
  ScreenCaptureKit: "SCREEN_CAPTURE_KIT",
  Encode: "ENCODE",
  AlreadyRecording: "ALREADY_RECORDING",
  NotRecording: "NOT_RECORDING",
  UnknownCodec: "UNKNOWN_CODEC",
  CameraNotFound: "CAMERA_NOT_FOUND",
  CameraUnavailable: "CAMERA_UNAVAILABLE",
  RecorderPoisoned: "RECORDER_POISONED",
  AlreadyTranscribing: "ALREADY_TRANSCRIBING",
} as const;

export type RecorderErrorCode = (typeof RecorderErrorCode)[keyof typeof RecorderErrorCode];

/**
 * Splits a native error into its machine-readable code and human message.
 *
 * The Rust side formats errors as `CODE: message`; the code lets the UI branch
 * (e.g. show a "grant permission" flow) without matching on prose.
 */
export function describeRecorderError(error: unknown): {
  code: RecorderErrorCode | null;
  message: string;
} {
  const raw = error instanceof Error ? error.message : String(error);
  const separator = raw.indexOf(": ");
  if (separator === -1) return { code: null, message: raw };

  const candidate = raw.slice(0, separator);
  return Object.values(RecorderErrorCode).includes(candidate as RecorderErrorCode)
    ? { code: candidate as RecorderErrorCode, message: raw.slice(separator + 2) }
    : { code: null, message: raw };
}

let cached: Recorder | null = null;

/**
 * Loads the native recorder.
 *
 * There is no stub behind an environment variable any more. Tests that need a
 * stand-in build one themselves and hand it to `setRecorder` below, which is
 * both explicit at the call site and impossible to leave switched on by a stray
 * variable in a shell that then records nothing for the rest of the afternoon.
 */
export async function getRecorder(): Promise<Recorder> {
  if (cached) return cached;

  cached = (await import("@prequel/recorder")) as unknown as Recorder;

  return cached;
}

/** Replaces the recorder. Tests only. */
export function setRecorder(recorder: Recorder | null): void {
  cached = recorder;
}
