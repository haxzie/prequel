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

import { toEveryWindow } from "../broadcast.js";

import type { TranscribeProgress } from "../../shared/contract.js";
import { IPC_CHANNELS } from "../../shared/contract.js";
import type { Manifest } from "../../shared/manifest.js";
import { MANIFEST_FILE_NAME, findTrack, parseManifest } from "../../shared/manifest.js";
import {
  TRANSCRIPT_FILE_NAME,
  TRANSCRIPT_VERSION,
  onSessionClock,
  parseTranscript,
  untranscribed,
  type Transcript,
} from "../../shared/transcript.js";
import { track } from "../analytics.js";
import { log } from "../log.js";
import { apple } from "./apple.js";
import { TranscribeError, type TranscribeResult, type Transcriber } from "./transcriber.js";

/** The directory currently being transcribed, or null. */
let running: string | null = null;
let cancelling: AbortController | null = null;

/**
 * Transcribes whatever in a recording has not been transcribed yet, and writes
 * `transcript.json`.
 *
 * The microphone, and the sound of any clip imported into the recording — see
 * `speechSegments`. Extending rather than replacing, so adding footage to a
 * recording that already has captions costs one pass over the new footage
 * instead of a fresh pass over all of it.
 *
 * Rejects a second one rather than queueing. Two of these on the same recording
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

    // What is already on disk, and what it has not listened to. Both, because
    // footage can be added to a recording that has already been transcribed —
    // an imported clip, or a second take — and the words already written are
    // still right: appending never moves an existing timestamp.
    const existing = await readExisting(dir, manifest.id);
    const pending = untranscribed(manifest, existing);

    if (pending.length === 0) {
      throw new TranscribeError(
        "NO_SPEECH",
        existing
          ? "Everything in this recording has been transcribed already."
          : "This recording has no microphone or imported clip to transcribe.",
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

    // One pass per segment: a recording extended with another take has one file
    // per take, and each is its own zero-based recording as far as any provider
    // is concerned. An imported clip's file is its video — `AVAudioFile` reads
    // the sound out of an MP4 with a picture in it, so nothing has to be
    // extracted first.
    const total = pending.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
    const words: Transcript["words"] = [...(existing?.words ?? [])];
    let done = 0;
    let last: TranscribeResult | null = null;

    // Listened to, and what stopped the rest being listened to. Per segment,
    // because one file saying nothing must not decide anything about the next:
    // a take recorded with the microphone muted sits in the middle of plenty of
    // recordings, and it used to take the whole transcription down with it —
    // including the imported clip after it, which had a hundred and sixty words
    // in it. Nothing was written, and the editor tried again on every open.
    const covered: string[] = [];
    let failure: unknown = null;

    for (const segment of pending) {
      // The path rather than the bytes: the engine opens the file itself, and
      // reading a half-hour take in only to hand it straight back would be the
      // peak memory of the whole app for nothing.
      const audio = join(dir, segment.file_name);
      const share = total > 0 ? (segment.end - segment.start) / total : 1;
      const base = done;

      try {
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
        covered.push(segment.file_name);
        last = result;
      } catch (cause) {
        // A cancellation is the whole job, not this file.
        if (controller.signal.aborted) throw cause;

        // Nothing was said in it, which is an answer rather than a failure.
        // Counted as listened to, so it is not offered again on every open for
        // the rest of the recording's life.
        if (cause instanceof TranscribeError && cause.code === "NO_SPEECH") {
          covered.push(segment.file_name);
          console.warn(`[transcribe] no speech in ${segment.file_name}`);
        } else {
          // A real failure — a file that would not open, a model that went
          // away. Deliberately *not* covered, so the next open tries it again,
          // and held in case it turns out to be the only thing that happened.
          failure ??= cause;
          console.error(`[transcribe] could not transcribe ${segment.file_name}:`, cause);
        }
      }

      done = base + share;
    }

    // Nothing was listened to at all: report whatever stopped it, rather than
    // writing a transcript that claims the recording is silent.
    if (covered.length === 0) throw failure ?? new TranscribeError("FAILED", "Nothing to read.");

    const transcript: Transcript = {
      version: TRANSCRIPT_VERSION,
      recordingId: manifest.id,
      provider: provider.name,
      // Sorted, because a pass that only added the tail is the common case but
      // not the guaranteed one, and everything downstream walks these in order.
      // The list of what has been listened to grows with them — see `covered`.
      // The last segment's, falling back to what the transcript already said —
      // every segment ran through the same provider on the same machine, so
      // these describe the engine and not the audio. A pass where every file
      // was silent has no result of its own to describe, and an older
      // transcript's answer is the true one there.
      model: last?.model ?? existing?.model ?? "",
      language: last?.language ?? existing?.language ?? "",
      timings: last?.timings ?? existing?.timings ?? "interpolated",
      words: words.sort((a, b) => a.at - b.at),
      // What was actually listened to, which is not the same as what was
      // offered: a file that failed to open is left out so the next open picks
      // it up again.
      covered: [...(existing?.covered ?? coveredBefore(manifest, existing)), ...covered],
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

/**
 * The transcript beside this recording, or null.
 *
 * Read here as well as in `readEditorSession` because this is where it is
 * extended: what has already been listened to is the only thing that says which
 * files are left. A transcript that will not parse is null, which transcribes
 * the recording from the top — the same answer the editor gives it.
 */
async function readExisting(dir: string, recordingId: string): Promise<Transcript | null> {
  try {
    return parseTranscript(await readFile(join(dir, TRANSCRIPT_FILE_NAME), "utf8"), recordingId);
  } catch {
    return null;
  }
}

/**
 * What a transcript written before `covered` existed had listened to.
 *
 * The microphone, and only the microphone — that is all any of those builds
 * transcribed. Written out in full on the way past so the next run has a list
 * rather than this assumption again.
 */
function coveredBefore(manifest: Manifest, existing: Transcript | null): string[] {
  if (!existing) return [];

  const mic = findTrack(manifest, "microphone");
  return mic?.segments.map((segment) => segment.file_name) ?? [];
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
  toEveryWindow(IPC_CHANNELS.transcribeProgress, { ...update, dir } satisfies TranscribeProgress);
}
