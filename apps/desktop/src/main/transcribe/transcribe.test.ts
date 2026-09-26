/**
 * What gets listened to, and what does not get listened to twice.
 *
 * A transcription used to be one thing that either had happened or had not.
 * Footage can now be added to a recording that already has captions — a video
 * imported onto the end of it — and the two failures worth pinning are both
 * silent: transcribing the whole recording again (minutes of work, and the same
 * words handed back), or transcribing nothing at all because a transcript
 * exists and the new clip is never heard.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Transcript } from "../../shared/transcript.js";

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  // Progress goes to every live window, and there are none here.
  webContents: { getAllWebContents: () => [] },
}));

const { startTranscribe } = await import("./index.js");
const { setRecorder } = await import("../recorder.js");
const { MANIFEST_FILE_NAME, MANIFEST_VERSION } = await import("../../shared/manifest.js");
const { TRANSCRIPT_FILE_NAME, TRANSCRIPT_VERSION } = await import("../../shared/transcript.js");

const S = 1_000_000_000;

const ROOT = mkdtempSync(join(tmpdir(), "prequel-transcribe-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

let dir = "";
let counter = 0;

/** Every file the fake engine was asked to listen to, in order. */
let heard: string[] = [];

/**
 * An engine that answers with one word per file, named after the file.
 *
 * Enough to tell which audio was read and where its words landed, which is the
 * whole question here — the real engines are Apple's and are not under test.
 */
function engine(silent: string[] = []) {
  setRecorder({
    speechAvailability: () => ({ analyzer: true, recogniser: true }),
    startTranscribe: (options: { audio: string }, onProgress: (e: null, u: unknown) => void) => {
      const file = options.audio.slice(dir.length + 1);
      heard.push(file);

      // What a take recorded with the microphone muted gets back, and what both
      // Apple engines call it.
      if (silent.includes(file)) {
        onProgress(null, {
          stage: "failed",
          code: "NO_SPEECH",
          message: "No speech was heard in this recording's microphone track.",
        });
        return;
      }

      onProgress(null, {
        stage: "done",
        words: JSON.stringify([{ at: 0.5, end: 1, text: file, confidence: 1 }]),
        language: "en-GB",
        model: "test",
        timings: "native",
      });
    },
    cancelTranscribe: () => undefined,
  } as never);
}

/** A recording with a microphone, and optionally an imported clip on the end. */
function recording(imported: boolean): string {
  const path = join(ROOT, `recording-${(counter += 1)}`);
  mkdirSync(path, { recursive: true });

  writeFileSync(
    join(path, MANIFEST_FILE_NAME),
    JSON.stringify({
      version: MANIFEST_VERSION,
      id: "recording-id",
      started_at: "2026-09-25T10:00:00.000Z",
      duration: imported ? 14 * S : 10 * S,
      source: { kind: "display", id: 1, title: "Display", scale_factor: 2 },
      tracks: [
        {
          kind: "microphone",
          segments: [{ file_name: "mic.m4a", start: 0, end: 10 * S, samples: 0, dropped: 0 }],
        },
        ...(imported
          ? [
              {
                kind: "system_audio",
                segments: [
                  { file_name: "2/screen.mp4", start: 10 * S, end: 14 * S, samples: 0, dropped: 0 },
                ],
              },
            ]
          : []),
      ],
      takes: [
        { dir: "", start: 0, end: 10 * S },
        ...(imported ? [{ dir: "2", start: 10 * S, end: 14 * S, imported: true }] : []),
      ],
    }),
  );

  return path;
}

const stored = (): Transcript =>
  JSON.parse(readFileSync(join(dir, TRANSCRIPT_FILE_NAME), "utf8")) as Transcript;

beforeEach(() => {
  heard = [];
  engine();
});

describe("startTranscribe", () => {
  it("reads the microphone and the imported clip's own sound", async () => {
    dir = recording(true);

    await startTranscribe(dir);

    expect(heard).toEqual(["mic.m4a", "2/screen.mp4"]);
    // On the session clock, each from its own segment's start — the imported
    // clip's words belong where the clip plays, not half a second in.
    expect(stored().words.map((word) => word.at)).toEqual([500_000_000, 10 * S + 500_000_000]);
  });

  it("listens only to what it has not heard before", async () => {
    dir = recording(true);
    writeFileSync(
      join(dir, TRANSCRIPT_FILE_NAME),
      JSON.stringify({
        version: TRANSCRIPT_VERSION,
        recordingId: "recording-id",
        provider: "apple",
        model: "test",
        language: "en-GB",
        timings: "native",
        words: [{ at: 0, end: 1000, text: "already", confidence: 1 }],
        covered: ["mic.m4a"],
      }),
    );

    await startTranscribe(dir);

    // The microphone is not read again, and the word it produced the first time
    // is still there: appending never moves an existing timestamp.
    expect(heard).toEqual(["2/screen.mp4"]);
    expect(stored().words.map((word) => word.text)).toEqual(["already", "2/screen.mp4"]);
    expect(stored().covered).toEqual(["mic.m4a", "2/screen.mp4"]);
  });

  it("keeps going when a file has nothing in it", async () => {
    // The bug this exists for: a recording whose microphone take was silent,
    // with an imported clip after it. The silent file threw, the whole run was
    // abandoned, and the clip's words — which the engine had no trouble with —
    // were never reached. Nothing was written, so it happened again on every
    // open.
    dir = recording(true);
    engine(["mic.m4a"]);

    await startTranscribe(dir);

    expect(heard).toEqual(["mic.m4a", "2/screen.mp4"]);
    expect(stored().words.map((word) => word.text)).toEqual(["2/screen.mp4"]);
    // The silent file counts as listened to: asking it again would get the same
    // nothing, on every open, for the rest of the recording's life.
    expect(stored().covered).toEqual(["mic.m4a", "2/screen.mp4"]);
  });

  it("writes a transcript even when everything was silent", async () => {
    dir = recording(false);
    engine(["mic.m4a"]);

    await startTranscribe(dir);

    // No words, and nothing left to listen to — which is what stops the editor
    // offering the same doomed transcription every time it opens.
    expect(stored().words).toEqual([]);
    expect(stored().covered).toEqual(["mic.m4a"]);
  });

  it("refuses a recording it has heard all of", async () => {
    dir = recording(false);

    await startTranscribe(dir);
    heard = [];

    // Not an error path anybody reaches from the editor, which asks
    // `untranscribed` first — but a second window, or a retry, must not append
    // the same words a second time.
    await startTranscribe(dir);

    expect(heard).toEqual([]);
    expect(stored().words).toHaveLength(1);
  });
});
