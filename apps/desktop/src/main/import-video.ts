/**
 * Bringing a video that was never recorded here into a recording.
 *
 * The imported file becomes a take, exactly as a second recording does: it is
 * copied into a numbered subdirectory under the name the capture would have
 * written, given a `session.json` of its own, and handed to `mergeTake`. That
 * is the whole design — there is no second path through the editor, the export
 * or the timeline for footage that came from outside, because a second path is
 * a second set of bugs in the one place a preview and an export must agree.
 *
 * What an imported take is, then, is a screen recording with nothing else in
 * it: no camera, no microphone, no pointer, no clicks and no key presses. The
 * file's own sound is the `system_audio` track, which is what a screen
 * recording's sound already is.
 *
 * Copied rather than referenced. Every other file a recording plays lives
 * inside its directory — the media protocol will not serve anything outside the
 * recordings folder, and the exporter resolves a segment's name against the
 * session directory — so a recording that pointed at somebody's Downloads
 * folder would edit until the file moved and then export black.
 */
import { copyFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { dialog, type BrowserWindow } from "electron";

import type { CursorSample, Manifest, Track } from "../shared/manifest.js";
import { MANIFEST_FILE_NAME, MANIFEST_VERSION, parseManifest } from "../shared/manifest.js";
import { log } from "./log.js";
import { getRecorder } from "./recorder.js";
import { deleteRecording, newTakePath } from "./session.js";
import { mergeTake, type Merged } from "./session-merge.js";

/**
 * What the picker offers.
 *
 * QuickTime's containers and nothing else, because both sides of the app have
 * to read what comes back: AVFoundation decodes the export, and Chromium
 * decodes the preview. A `.webm` would play in the editor and fail in the
 * exporter — which is the worst shape a failure can have here, since it only
 * appears once somebody has finished editing.
 */
export const VIDEO_KINDS = ["mp4", "mov", "m4v"] as const;

/**
 * The name the imported file is copied in under.
 *
 * Fixed, and `.mp4` whatever the source was called. Two things need it:
 * `probeSession` looks for the four fixed names at the root of the directory it
 * is given, and the media protocol serves an allow-list of extensions. A `.mov`
 * under this name is still a QuickTime file and both decoders read the
 * container rather than the name.
 */
const IMPORTED_FILE_NAME = "screen.mp4";

/**
 * Where an imported clip's pointer sits: off the captured frame.
 *
 * Positions are fractions of the frame, and a sample outside it is drawn as a
 * pointer that has left the screen rather than clamped to the edge — see
 * `cursorAt`. That is exactly the truth about imported footage, and it is the
 * only way to say it: without a sample of its own, the last one the *recording*
 * took holds for the rest of time, and the pointer sits frozen over footage it
 * was never in.
 */
const OFF_FRAME = -1;

/** What the probe says about the file being brought in. */
export interface ImportedMedia {
  /** Nanoseconds, the longer of the picture and the sound. */
  duration: number;
  width?: number;
  height?: number;
  frameRate?: number;
  hasAudio: boolean;
}

/**
 * The `session.json` an imported file gets, as though it had been recorded.
 *
 * Take-relative, like every take's own manifest: `mergeTake` shifts all of it
 * onto the parent's clock. Pure, so the shape this writes is testable without a
 * file, a probe or an editor.
 *
 * `from` is where the recording's pointer was last seen, or null when it has no
 * pointer track at all. It buys one held sample at the seam: the pointer stays
 * on screen through the footage it was recorded in and disappears a nanosecond
 * into the footage it was not — the same pair of markers `withIdleGaps` writes,
 * for the same reason.
 */
export function importedManifest(
  media: ImportedMedia,
  options: {
    id?: string;
    name: string;
    startedAt?: string;
    from?: { x: number; y: number } | null;
  },
): Manifest {
  const { duration } = media;

  const tracks: Track[] = [
    {
      kind: "screen",
      segments: [
        {
          file_name: IMPORTED_FILE_NAME,
          start: 0,
          end: duration,
          width: media.width,
          height: media.height,
          // What the file holds, as closely as its frame rate says. Nothing in
          // the app reads it — it is the recorder's own account of how much it
          // wrote — so an unknown rate reports nothing rather than a guess.
          samples: media.frameRate ? Math.round((duration / 1_000_000_000) * media.frameRate) : 0,
          dropped: 0,
        },
      ],
    },
  ];

  // The same file again, which is the point: the sound is inside the video and
  // both readers take the first track of the type they want. Written only when
  // there is one — a `system_audio` segment naming a file with no audio track
  // fails the export at `AudioReader`, long after the import looked like it
  // worked.
  if (media.hasAudio) {
    tracks.push({
      kind: "system_audio",
      segments: [
        { file_name: IMPORTED_FILE_NAME, start: 0, end: duration, samples: 0, dropped: 0 },
      ],
    });
  }

  const cursor: CursorSample[] = options.from
    ? [
        { at: 0, x: options.from.x, y: options.from.y },
        { at: 1, x: OFF_FRAME, y: OFF_FRAME },
      ]
    : [];

  return {
    version: MANIFEST_VERSION,
    // Never read after the merge, which keeps the parent's id: a take's id
    // exists so an unmerged take on disk is still a whole recording.
    id: options.id ?? randomUUID(),
    started_at: options.startedAt ?? new Date().toISOString(),
    duration,
    // `kind` is the one field here that is not a recording's. Nothing reads a
    // take's source — the merge keeps the parent's, which is what describes
    // what this project is of — and calling an imported file a display would
    // be a lie an unmerged take on disk would then tell about itself.
    source: {
      kind: "file",
      id: 0,
      title: options.name,
      scale_factor: 1,
    },
    tracks,
    // Marked, and the merge carries the mark onto the recording's take table.
    // It is what tells the transcription that this take's sound is somebody
    // talking rather than whatever was playing through the speakers.
    takes: [{ dir: "", start: 0, end: duration, imported: true }],
    // Baked is how a recording says it has no pointer layer, and an imported
    // file has none: there is nothing to restyle, smooth or hide. The markers
    // below are the exception — they exist to take the *recording's* pointer
    // off the screen at the seam, and a take carrying samples has to claim a
    // layer or nothing would read them.
    cursor_baked: cursor.length === 0,
    ...(cursor.length > 0 ? { cursor } : {}),
  };
}

/**
 * Asks for a video file. Null when the dialog was dismissed.
 *
 * Modal to the editor window, so it cannot be lost behind it while the editor
 * waits for an answer.
 */
export async function chooseVideo(window: BrowserWindow | null): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(window ?? undefined!, {
    title: "Choose a video",
    buttonLabel: "Import",
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: [...VIDEO_KINDS] }],
  });

  const source = filePaths[0];
  return canceled || !source ? null : source;
}

/**
 * Copies a video into a recording and appends it as a take.
 *
 * Null when there was nothing usable to add, having already said why. The take
 * directory goes with it: an empty numbered folder is one the recovery pass on
 * every open has to walk past for ever.
 *
 * The copy happens before the probe, deliberately. AVFoundation is about to
 * read the file the editor will play, and probing the original would describe a
 * file nobody ends up using — a sandboxed copy, a network volume that
 * disappears mid-copy, a truncated write.
 */
export async function importVideo(dir: string, source: string): Promise<Merged | null> {
  const takeDir = newTakePath(dir);
  const file = join(takeDir, IMPORTED_FILE_NAME);

  try {
    await copyFile(source, file);

    const probe = await (await getRecorder()).probeMedia(file);

    if (!probe.hasVideo || probe.duration <= 0) {
      // Not an error worth a report: the file opened, it simply is not footage.
      // A picture or a sound file reaching here means the picker's filters were
      // bypassed, which "All Files" in the macOS dialog will do.
      console.warn(`[import] ${basename(source)} holds no video`);
      deleteRecording(takeDir);
      return null;
    }

    writeFileSync(
      join(takeDir, MANIFEST_FILE_NAME),
      JSON.stringify(
        importedManifest(
          {
            duration: probe.duration,
            width: probe.width,
            height: probe.height,
            frameRate: probe.frameRate,
            hasAudio: probe.hasAudio,
          },
          { name: basename(source), from: lastCursorPoint(dir) },
        ),
        null,
        2,
      ),
    );

    log("info", "video imported", {
      dir,
      take: basename(takeDir),
      duration: probe.duration,
      audio: probe.hasAudio,
    });
  } catch (cause) {
    console.error(`[import] could not import ${basename(source)}:`, cause);
    deleteRecording(takeDir);
    return null;
  }

  // From here it is an ordinary take: the merge puts it on the recording's
  // clock, appends a clip for it and leaves the base untouched if anything goes
  // wrong. See `session-merge.ts`.
  return mergeTake(dir, takeDir);
}

/**
 * Where the recording's pointer was last seen, or null.
 *
 * Null for a recording whose pointer was baked into the frames, and for one
 * that never sampled it: there is no layer to hide, so there is nothing for the
 * imported take to say about it.
 */
function lastCursorPoint(dir: string): { x: number; y: number } | null {
  try {
    const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
    if (manifest.cursor_baked ?? true) return null;

    const last = manifest.cursor?.at(-1);
    return last ? { x: last.x, y: last.y } : null;
  } catch {
    // Not this function's business to report: the merge is about to read the
    // same file and say so.
    return null;
  }
}
