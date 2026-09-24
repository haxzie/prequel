/**
 * Running one transcription at a time, and telling the editor how it is going.
 *
 * Shaped like `main/export.ts` on purpose: one job, progress broadcast to every
 * live renderer, and completion delivered as a terminal progress event rather
 * than a resolved promise. Two channels for one job is how an editor comes to
 * show a finished state and a running spinner at the same time.
 *
 * Like the export, the work happens in Rust — and in the Swift behind it. That
 * is a change: this used to upload `mic.m4a` to OpenAI through our own Worker.
 * Nothing leaves the machine now, so there is no size ceiling, no allowance to
 * count against an install, and — because both Apple engines measure each word
 * rather than interpolating from a segment — the transcript can carry times
 * good enough to light a word with.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { webContents } from "electron";

import type { TranscribeProgress } from "../../shared/contract.js";
import { IPC_CHANNELS } from "../../shared/contract.js";
import { MANIFEST_FILE_NAME, parseManifest } from "../../shared/manifest.js";
import {
  TRANSCRIPT_FILE_NAME,
  TRANSCRIPT_VERSION,
  onSessionClock,
  type Transcript,
} from "../../shared/transcript.js";
import { track } from "../analytics.js";
import { log } from "../log.js";
import { apple } from "./apple.js";
import { TranscribeError, type TranscribeResult, type Transcriber } from "./transcriber.js";

/** The directory currently being transcribed, or null. */
let running: string | null = null;
let cancelling: AbortController | null = null;

export function isTranscribing(): boolean {
  return running !== null;
}

/**
 * Transcribes a recording's microphone track and writes `transcript.json`.
 *
 * Rejects a second one rather than queueing. Two uploads of the same recording
 * would both write the same file, and the loser would overwrite the winner.
 */
export async function startTranscribe(dir: string): Promise<void> {
  if (running) {
    throw new Error("ALREADY_TRANSCRIBING: a transcription is already running");
  }

  running = dir;
  const controller = new AbortController();
  cancelling = controller;

  track("transcription_started");
  log("info", "transcription started", dir);

  try {
    const manifest = parseManifest(await readFile(join(dir, MANIFEST_FILE_NAME), "utf8"));
    const mic = manifest.tracks.find((track) => track.kind === "microphone");

    if (!mic) {
      throw new TranscribeError(
        "NO_MICROPHONE",
        "This recording has no microphone track to transcribe.",
      );
    }

    const provider = transcriber();
    broadcast({ stage: "preparing", progress: null, error: null });

    // Asked before the work rather than discovered from a failed run, and it
    // never prompts. A machine with no on-device model has to be told so, not
    // shown a permission dialog and then an error.
    if (!(await provider.available())) {
      throw new TranscribeError(
        "NO_LOCAL_MODEL",
        "macOS has no on-device speech model for this language. Add it in System Settings under Keyboard, Dictation.",
      );
    }

    // One pass per segment: a recording extended with another take has one mic
    // file per take, and each is its own zero-based recording as far as any
    // provider is concerned.
    const total = mic.segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
    const words: Transcript["words"] = [];
    let done = 0;
    let last: TranscribeResult | null = null;

    for (const segment of mic.segments) {
      // The path rather than the bytes: the engine opens the file itself, and
      // reading a half-hour take in only to hand it straight back would be the
      // peak memory of the whole app for nothing.
      const audio = join(dir, segment.file_name);
      const share = total > 0 ? (segment.end - segment.start) / total : 1;
      const base = done;

      const result = await provider.transcribe(audio, controller.signal, (stage, progress) =>
        // Weighted by how much of the recording this segment is, so the bar
        // crosses the whole recording once rather than restarting per take.
        broadcast({
          stage,
          progress: progress === null ? null : base + progress * share,
          error: null,
        }),
      );

      // The one clock conversion. The provider measured from the start of this
      // segment's file, which is zero-based; where that file sits in the
      // session lives only in the manifest.
      words.push(...onSessionClock(result.words, segment));
      done = base + share;
      last = result;
    }

    const transcript: Transcript = {
      version: TRANSCRIPT_VERSION,
      recordingId: manifest.id,
      provider: provider.name,
      // The last segment's, and every segment ran through the same provider on
      // the same machine — these describe the engine, not the audio. A track
      // always has a segment, so the fallbacks are unreachable; interpolated is
      // the one that makes the editor decline word-by-word highlighting rather
      // than light the wrong word.
      model: last?.model ?? "",
      language: last?.language ?? "",
      timings: last?.timings ?? "interpolated",
      words,
    };

    await writeFile(join(dir, TRANSCRIPT_FILE_NAME), JSON.stringify(transcript, null, 2), "utf8");

    finish({ stage: "done", progress: 1, error: null, transcript });
  } catch (cause) {
    if (controller.signal.aborted) {
      finish({ stage: "cancelled", progress: null, error: null });
      return;
    }

    const error =
      cause instanceof TranscribeError
        ? { code: cause.code, message: cause.message }
        : { code: null, message: cause instanceof Error ? cause.message : String(cause) };

    // Logged as well as shown: the editor's message is gone the moment the
    // window closes, and a failed transcription is the kind of thing a user
    // reports hours later.
    console.error(`transcription failed: ${error.message}`);
    finish({ stage: "failed", progress: null, error });
  }
}

/** Asks the running transcription to stop. Safe to call when nothing is running. */
export function cancelTranscribe(): void {
  cancelling?.abort();
}

/**
 * The provider to use.
 *
 * One, and on this machine. A second is a new file beside `apple.ts` and a
 * branch here; the shape the rest of this module depends on is `Transcriber`.
 */
function transcriber(): Transcriber {
  return apple();
}

function finish(update: Omit<TranscribeProgress, "dir">): void {
  // Read before it is cleared: the editor keys progress on the directory, and a
  // terminal event with an empty one would be ignored by the window waiting for
  // it — a spinner that never stops.
  const dir = running ?? "";
  running = null;
  cancelling = null;

  // The stage only. `completed` also lands server-side from `/v1/transcribe`
  // with the word count on it; this one is what says the editor got the result,
  // which is a different thing from OpenAI having returned one.
  track(`transcription_${update.stage}`);

  log("info", `transcription ${update.stage}`);
  broadcast(update, dir);
}

/**
 * Pushes progress to every live renderer.
 *
 * Broadcast rather than sent to one window, matching how the export's progress
 * already travels: the editor that started it is not necessarily the only one
 * open on that recording.
 */
function broadcast(update: Omit<TranscribeProgress, "dir">, dir = running ?? ""): void {
  const message: TranscribeProgress = { ...update, dir };

  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) {
      contents.send(IPC_CHANNELS.transcribeProgress, message);
    }
  }
}
