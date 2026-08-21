/**
 * Deterministic stand-in for the native recorder.
 *
 * Used by end-to-end runs and by any environment without the Screen Recording
 * grant. It satisfies the same `Recorder` contract as the real addon — including
 * the same error codes for invalid transitions — so the UI cannot tell the
 * difference and tests exercise the real error paths.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Manifest, Track } from "../shared/manifest.js";
import { MANIFEST_FILE_NAME, MANIFEST_VERSION, TRACK_FILE_NAMES } from "../shared/manifest.js";
import type {
  PermissionStatus,
  Recorder,
  RecordingResult,
  RecordingState,
  StartRecordingRequest,
  Target,
} from "./recorder.js";

const NS_PER_MS = 1_000_000;

/** Smallest bytes that will pass as an M4A container. */
const STUB_M4A = Buffer.from(
  "AAAAIGZ0eXBNNEEgAAAAAE00QSBtcDQyaXNvbQAAAAhmcmVlAAAACG1kYXQ=",
  "base64",
);

const FAKE_TARGETS: Target[] = [
  {
    kind: "Display",
    id: 1,
    title: "Display 3024×1964",
    appName: "",
    appPath: "",
    bounds: { x: 0, y: 0, width: 1512, height: 982 },
    scaleFactor: 2,
  },
  {
    kind: "Display",
    id: 2,
    title: "Display 2560×1440",
    appName: "",
    appPath: "",
    bounds: { x: 1512, y: 0, width: 2560, height: 1440 },
    scaleFactor: 1,
  },
  {
    kind: "Window",
    id: 1001,
    title: "prequel — recorder.rs",
    appName: "Visual Studio Code",
    appPath: "/Applications/Visual Studio Code.app",
    bounds: { x: 120, y: 80, width: 1400, height: 900 },
    scaleFactor: 1,
  },
  {
    kind: "Window",
    id: 1002,
    title: "Inbox",
    appName: "Safari",
    appPath: "/Applications/Safari.app",
    bounds: { x: 300, y: 200, width: 1100, height: 800 },
    scaleFactor: 1,
  },
];

/** Smallest bytes that `ffprobe` and Finder will accept as an MP4 container. */
const STUB_MP4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAhtZGF0",
  "base64",
);

/** The camera's plausible warm-up, matching `cameraStartMs` in the result. */
const CAMERA_START_MS = 250;

/**
 * The microphone's plausible warm-up.
 *
 * Non-zero for the same reason the camera's is. Every session media file is
 * written zero-based, so a track's late start exists only in the manifest —
 * and a transcript's word times are the provider's offsets into `mic.m4a` plus
 * exactly this number. A fake that started the microphone at zero would let
 * captions that are systematically a fifth of a second early pass every test
 * and every manual check on this machine.
 */
const MIC_START_MS = 180;

/**
 * Writes the session manifest, as the native recorder does on stop.
 *
 * The offsets matter more than the file bytes: the camera track starts late,
 * and anything reassembling the tracks has to honour that. A fake that wrote
 * every track starting at zero would let a sync bug pass unnoticed.
 */
function writeManifest(
  request: StartRecordingRequest,
  target: Target,
  summary: { durationMs: number; width: number; height: number; camera: boolean },
): void {
  const duration = summary.durationMs * NS_PER_MS;
  const fps = request.fps ?? 60;

  const tracks: Track[] = [
    {
      kind: "screen",
      file_name: TRACK_FILE_NAMES.screen,
      // The screen anchors the clock, so it starts at zero by construction.
      start: 0,
      end: duration,
      width: summary.width,
      height: summary.height,
      samples: Math.round((summary.durationMs / 1000) * fps),
      dropped: 0,
    },
  ];

  if (summary.camera) {
    tracks.push({
      kind: "camera",
      file_name: TRACK_FILE_NAMES.camera,
      start: CAMERA_START_MS * NS_PER_MS,
      end: duration,
      width: 1280,
      height: 720,
      samples: Math.round((summary.durationMs / 1000) * 30),
      dropped: 0,
    });
  }

  for (const kind of ["system_audio", "microphone"] as const) {
    const requested = kind === "system_audio" ? request.systemAudio : request.microphone;
    if (!requested) continue;

    // System audio is tapped from the same stream as the screen and starts with
    // it; the microphone is a device and has to open first.
    const start = kind === "microphone" ? MIC_START_MS * NS_PER_MS : 0;

    tracks.push({
      kind,
      file_name: TRACK_FILE_NAMES[kind],
      start,
      end: duration,
      samples: Math.round(((summary.durationMs - start / NS_PER_MS) / 1000) * 48_000),
      dropped: 0,
    });
  }

  // Optional on the addon's request type, though the session always stamps it.
  // Falling back keeps the fake from writing a manifest with `undefined` in it.
  const startedAt = request.startedAt ?? new Date().toISOString();

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    id: startedAt,
    started_at: startedAt,
    duration,
    source: {
      kind: target.kind === "Display" ? "display" : "window",
      id: target.id,
      title: target.title,
      app_name: target.appName,
      scale_factor: target.scaleFactor,
    },
    tracks,
    cursor: [],
  };

  writeFileSync(join(request.outputPath, MANIFEST_FILE_NAME), JSON.stringify(manifest, null, 2));
}

export function createFakeRecorder(): Recorder {
  let state: RecordingState = "Idle" as RecordingState;
  let request: StartRecordingRequest | null = null;
  let startedAt = 0;
  let pausedAt = 0;
  let pausedTotal = 0;

  return {
    screenAccessStatus: () => "Granted",
    requestScreenAccess: () => "Granted",

    listTargets: async () =>
      FAKE_TARGETS.map((target) => ({ ...target, bounds: { ...target.bounds } })),

    // Named as AVFoundation would, without Chromium's trailing USB ids, so the
    // name-matching the real flow depends on is exercised rather than bypassed.
    listCameras: () => [{ id: "fake-camera-0", name: "FaceTime HD Camera" }],
    // No device to warm, and nothing that could fail: the fake exists so the
    // whole flow runs on a machine with no camera at all.
    prepareCamera: () => Promise.resolve(),
    releaseCamera: () => {},

    startRecording: async (next) => {
      if (state !== "Idle") {
        throw new Error("ALREADY_RECORDING: a recording is already in progress");
      }
      request = next;
      startedAt = Date.now();
      pausedTotal = 0;
      state = "Recording" as RecordingState;
    },

    pauseRecording: () => {
      if (state !== "Recording") throw new Error("NOT_RECORDING: nothing is being recorded");
      pausedAt = Date.now();
      state = "Paused" as RecordingState;
    },

    resumeRecording: () => {
      if (state !== "Paused") throw new Error("NOT_RECORDING: nothing is being recorded");
      pausedTotal += Date.now() - pausedAt;
      state = "Recording" as RecordingState;
    },

    stopRecording: async (): Promise<RecordingResult> => {
      if (state === "Idle" || !request) {
        throw new Error("NOT_RECORDING: nothing is being recorded");
      }
      if (state === "Paused") pausedTotal += Date.now() - pausedAt;

      const durationMs = Math.max(0, Date.now() - startedAt - pausedTotal);
      const fps = request.fps ?? 60;
      const target =
        FAKE_TARGETS.find((t) => t.id === request!.targetId) ?? (FAKE_TARGETS[0] as Target);

      // Produce a real session directory so the UI's "reveal in Finder" path
      // is exercised the same way it is with the native recorder.
      mkdirSync(request.outputPath, { recursive: true });
      writeFileSync(join(request.outputPath, "screen.mp4"), STUB_MP4);

      // A camera produces a second file, as it does natively — otherwise an
      // end-to-end run would pass against a session that is missing a track.
      const camera = request.camera ?? null;
      if (camera) writeFileSync(join(request.outputPath, "camera.mp4"), STUB_MP4);

      const width = Math.round(target.bounds.width * target.scaleFactor) & ~1;
      const height = Math.round(target.bounds.height * target.scaleFactor) & ~1;

      // A requested-but-silent audio track produces no file natively, so the
      // fake only writes one where a device was actually asked for.
      if (request.systemAudio) {
        writeFileSync(join(request.outputPath, TRACK_FILE_NAMES.system_audio), STUB_M4A);
      }
      if (request.microphone) {
        writeFileSync(join(request.outputPath, TRACK_FILE_NAMES.microphone), STUB_M4A);
      }

      // The manifest is what makes a session openable at all — without it the
      // editor has nothing describing how the tracks line up, and an end-to-end
      // run would never get past opening the window.
      writeManifest(request, target, { durationMs, width, height, camera: camera !== null });

      state = "Idle" as RecordingState;
      request = null;

      return {
        frames: Math.round((durationMs / 1000) * fps),
        durationMs,
        width,
        height,
        idleFrames: 0,
        droppedFrames: 0,
        pausedFrames: 0,
        systemAudioSamples: 0,
        microphoneSamples: 0,
        cameraFrames: camera ? Math.round((durationMs / 1000) * 30) : 0,
        // A plausible warm-up, so anything consuming the offset is exercised
        // rather than always seeing a convenient zero.
        cameraStartMs: camera ? CAMERA_START_MS : 0,
        cameraWidth: camera ? 1280 : 0,
        cameraHeight: camera ? 720 : 0,
      };
    },

    recordingState: () => state,

    // There is no desktop to screenshot without a real display and grant, and
    // an invented image would make the wallpaper option look like it worked.
    captureWallpaper: async () => {
      throw new Error("WALLPAPER: the fake recorder cannot capture a desktop");
    },

    // The stub media has no frames to composite, so there is nothing to render.
    // Reported as a failure rather than a silent success, which would leave the
    // editor claiming an export that does not exist.
    startExport: (_options, onProgress) => {
      setTimeout(
        () =>
          onProgress(null, {
            stage: "failed",
            framesDone: 0,
            framesTotal: 0,
            outputPath: undefined,
            message: "the fake recorder cannot export",
          }),
        0,
      );
    },

    cancelExport: () => undefined,

    // Nothing native to route; the fake's own warnings go through console.
    setLogFile: () => undefined,

    // Reads the manifest the fake itself wrote, so the shape the editor
    // receives matches the native probe's without needing real media.
    probeSession: async (dir) => {
      let manifest: Manifest;
      try {
        manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8")) as Manifest;
      } catch {
        return [];
      }

      return manifest.tracks.map((track) => ({
        kind: track.kind,
        fileName: track.file_name,
        // Zero, as every real session file is — the late start lives in the
        // manifest, and a fake that reported it here would let a double
        // correction pass unnoticed.
        start: 0,
        duration: track.end - track.start,
        width: track.width,
        height: track.height,
        frameRate: track.kind === "screen" ? 60 : track.kind === "camera" ? 30 : undefined,
      }));
    },
  };
}
