/**
 * Running one transcription at a time, and telling the editor how it is going.
 *
 * Shaped like `main/export.ts` on purpose: one job, progress broadcast to every
 * live renderer, and completion delivered as a terminal progress event rather
 * than a resolved promise. Two channels for one job is how an editor comes to
 * show a finished state and a running spinner at the same time.
 *
 * Unlike the export, none of the work happens in Rust. The provider is reached
 * over HTTP from here, so there is no addon call and nothing to rebuild.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { webContents } from "electron";

import type { TranscribeProgress } from "../../shared/contract.js";
import { IPC_CHANNELS } from "../../shared/contract.js";
import { MANIFEST_FILE_NAME, TRACK_FILE_NAMES, parseManifest } from "../../shared/manifest.js";
import {
  TRANSCRIPT_FILE_NAME,
  TRANSCRIPT_VERSION,
  onSessionClock,
  type Transcript,
} from "../../shared/transcript.js";
import { track } from "../analytics.js";
import { log } from "../log.js";
import { apiUrl } from "../api.js";
import { authToken } from "../auth.js";
import { installId } from "../install-id.js";
import { openai } from "./openai.js";
import { TranscribeError, type Transcriber } from "./transcriber.js";

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
    broadcast({ stage: "uploading", error: null });

    const audio = await readFile(join(dir, TRACK_FILE_NAMES.microphone));
    if (audio.byteLength > provider.maxBytes) {
      throw new TranscribeError(
        "TOO_LONG",
        `This recording's audio is larger than ${provider.name} accepts.`,
      );
    }

    broadcast({ stage: "transcribing", error: null });
    const result = await provider.transcribe(audio, controller.signal);

    const transcript: Transcript = {
      version: TRANSCRIPT_VERSION,
      recordingId: manifest.id,
      provider: provider.name,
      model: result.model,
      language: result.language,
      timings: result.timings,
      // The one clock conversion. The provider measured from the start of
      // `mic.m4a`, which is zero-based; where that file sits in the session
      // lives only in the manifest.
      words: onSessionClock(result.words, mic),
    };

    await writeFile(join(dir, TRANSCRIPT_FILE_NAME), JSON.stringify(transcript, null, 2), "utf8");

    finish({ stage: "done", error: null, transcript });
  } catch (cause) {
    if (controller.signal.aborted) {
      finish({ stage: "cancelled", error: null });
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
    finish({ stage: "failed", error });
  }
}

/** Asks the running transcription to stop. Safe to call when nothing is running. */
export function cancelTranscribe(): void {
  cancelling?.abort();
}

/**
 * The provider to use.
 *
 * One today. A second is a new file beside `openai.ts` and a branch here — the
 * shape the rest of this module depends on is `Transcriber`, which carries the
 * two things that differ in ways the UI can see: the size it accepts and
 * whether its word times are real.
 */
function transcriber(): Transcriber {
  return openai(baseUrl, installId, authToken);
}

/**
 * Where the transcription route lives.
 *
 * `apiUrl` rather than a copy of the fallback chain: sharing and signing in call
 * the same Worker, and three separate resolutions of "where is the API" is how
 * one of them ends up on production while the others talk to `wrangler dev`.
 */
const baseUrl = apiUrl;

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
