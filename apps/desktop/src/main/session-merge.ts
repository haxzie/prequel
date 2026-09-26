/**
 * Folding a freshly recorded take into the recording it extends.
 *
 * The take is captured into its own subdirectory with its own `session.json`, as
 * though it were a whole recording — the capture crates know nothing about
 * takes. This is what puts it on the parent's session clock: every segment and
 * every sample shifts by however long the recording already was, and the tracks
 * are appended rather than replaced.
 *
 * **Nothing is written to the base recording until the merged manifest is
 * complete.** A quit, a crash or a throw partway leaves the base `session.json`
 * and `project.json` byte-identical and an orphan take directory holding real
 * footage and its own valid manifest — which `mergeUnmergedTakes` picks up on
 * the next open. A truncated `session.json` is not a lost edit, it is a
 * recording that no longer opens.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import type {
  ClickSample,
  CursorSample,
  KeyPress,
  KeySpan,
  Manifest,
  Segment,
  Track,
  TypingSample,
} from "../shared/manifest.js";
import { MANIFEST_FILE_NAME, parseManifest, seamsOf } from "../shared/manifest.js";
import { loadProject, saveProject, flushProject } from "./editor-project.js";
import { log } from "./log.js";

/** What a merge added, for the editor to select and seek to. */
export interface Merged {
  /** The appended slice's id. */
  sliceId: string;
  /** Where the new footage begins on the session clock. */
  at: number;
}

/**
 * The clip the last merge appended, per recording, until the editor reads it.
 *
 * Held here rather than put on disk because it describes an event and not a
 * state: the editor selects the new clip and seeks to it once, on the open that
 * follows the merge. Written into `project.json` it would move the selection
 * every time the recording was opened for the rest of its life.
 */
const focus = new Map<string, string>();

/** The clip a merge appended, if the editor has not been told about it yet. */
export function takeFocus(dir: string): string | null {
  const id = focus.get(dir) ?? null;
  focus.delete(dir);
  return id;
}

/**
 * Appends a take to the recording it was captured into.
 *
 * Null when nothing could be merged — an unparseable manifest on either side, or
 * a take already in the table. Never throws: the footage is on disk either way,
 * and the recording it was added to is the irreplaceable part.
 */
export function mergeTake(dir: string, takeDir: string): Merged | null {
  const name = basename(takeDir);

  let base: Manifest;
  let take: Manifest;
  try {
    base = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
    take = parseManifest(readFileSync(join(takeDir, MANIFEST_FILE_NAME), "utf8"));
  } catch (cause) {
    // Before anything is written, which is the whole shape of this function:
    // the base recording opens exactly as it did before the attempt.
    console.error(`[session] could not merge ${takeDir}:`, cause);
    return null;
  }

  // Idempotent by construction, which is what lets the recovery pass on open be
  // unconditional: the take table is the record of what has been merged.
  if (base.takes.some((entry) => (entry.dir ?? "") === name)) return null;

  // A take with no media is not footage, it is a directory. Merging it would
  // put a seam in the recording with nothing on the other side of it.
  if (take.duration <= 0 || take.tracks.length === 0) return null;

  const at = base.duration;

  const merged: Manifest = {
    ...base,
    // Unchanged, all three. It is still the same recording — which is what keeps
    // `project.json`'s and the transcript's `recordingId` checks passing — and
    // `source` describes the first take because nothing reads it per moment.
    id: base.id,
    started_at: base.started_at,
    source: base.source,
    duration: at + take.duration,
    tracks: mergeTracks(base.tracks, take.tracks, name, at),
    takes: [
      ...base.takes,
      {
        dir: name,
        start: at,
        end: at + take.duration,
        // Carried from the take's own table rather than decided here: what this
        // take is made of is the take's business, and the merge is the same
        // merge for a recording and for an import.
        ...(take.takes[0]?.imported ? { imported: true } : {}),
      },
    ],
    // Concatenated rather than merged and re-sorted: the take begins where the
    // recording ended, so appending keeps every array in clock order.
    cursor: [...(base.cursor ?? []), ...shiftPoints(take.cursor ?? [], at)],
    clicks: [...(base.clicks ?? []), ...shiftPoints(take.clicks ?? [], at)],
    typing: [...(base.typing ?? []), ...shiftPoints(take.typing ?? [], at)],
    keys: [...(base.keys ?? []), ...shiftSpans(take.keys ?? [], at)],
    key_presses: [...(base.key_presses ?? []), ...shiftPoints(take.key_presses ?? [], at)],
  };

  // Atomically, and before the project: a project naming a slice past the
  // manifest's duration is clamped away by `sanitiseProject`, where a manifest
  // holding a take the project does not use is just footage nobody has put on
  // the timeline. Both orders survive a crash; this one survives it quietly.
  if (!writeManifest(dir, merged)) return null;

  // The transcript is left exactly as it is. Appending never moves an existing
  // timestamp, so its words stay on the moments they were said — the new footage
  // simply has no words yet. This is the strongest argument for adding footage at
  // the end rather than in the middle.

  const sliceId = appendSlice(dir, merged, at);

  focus.set(dir, sliceId);
  log("info", "take merged", { dir, take: name, at, duration: take.duration });
  return { sliceId, at };
}

/**
 * Every unmerged take in a recording, merged.
 *
 * The crash path, made self-healing: a take whose merge never finished is real
 * footage in a numbered subdirectory that the take table does not mention, and
 * deleting it silently is not an option. Derivable from the table, so this is
 * idempotent rather than stateful.
 *
 * A take whose own manifest will not parse is warned about and left alone, which
 * bounds the work: it would otherwise be retried on every open for ever.
 */
export function mergeUnmergedTakes(dir: string): Merged | null {
  let manifest: Manifest;
  try {
    manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
  } catch {
    // Not this function's business to report: `readEditorSession` is about to
    // parse the same file and fail with the same reason.
    return null;
  }

  const merged = new Set(manifest.takes.map((take) => take.dir ?? ""));
  let last: Merged | null = null;

  // Numerically, so takes merge in the order they were recorded — the clock has
  // to be built in order or the seams land in the wrong places.
  const pending = takeDirs(dir)
    .filter((name) => !merged.has(name))
    .sort((a, b) => Number(a) - Number(b));

  for (const name of pending) {
    const result = mergeTake(dir, join(dir, name));
    if (result) last = result;
  }

  return last;
}

/** Numbered subdirectories of a recording that hold a manifest of their own. */
function takeDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .filter((entry) => existsSync(join(dir, entry.name, MANIFEST_FILE_NAME)))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * The base's tracks with the take's segments appended.
 *
 * A kind the base does not have gains a track whose first segment starts at the
 * seam — the microphone switched on for the second take and off for the first.
 * A kind the take does not have simply stops at the seam, which is what a camera
 * unplugged mid-recording already does.
 */
function mergeTracks(base: Track[], take: Track[], name: string, at: number): Track[] {
  const merged = base.map((track) => ({ ...track, segments: [...track.segments] }));

  for (const track of take) {
    const segments = track.segments.map((segment) => shiftSegment(segment, name, at));
    const existing = merged.find((candidate) => candidate.kind === track.kind);
    if (existing) existing.segments.push(...segments);
    else merged.push({ kind: track.kind, segments });
  }

  return merged;
}

/**
 * One segment on the parent's clock, naming its file through the take directory.
 *
 * The file itself is untouched and still zero-based; only where it sits changes.
 * The matte comes with it, under the same prefix — it is a sidecar of this
 * segment's camera and nothing else.
 */
function shiftSegment(segment: Segment, name: string, at: number): Segment {
  return {
    ...segment,
    file_name: `${name}/${segment.file_name}`,
    start: segment.start + at,
    end: segment.end + at,
    ...(segment.matte
      ? { matte: { ...segment.matte, file_name: `${name}/${segment.matte.file_name}` } }
      : {}),
  };
}

function shiftPoints<T extends CursorSample | ClickSample | TypingSample | KeyPress>(
  samples: readonly T[],
  at: number,
): T[] {
  return samples.map((sample) => ({ ...sample, at: sample.at + at }));
}

function shiftSpans(spans: readonly KeySpan[], at: number): KeySpan[] {
  return spans.map((span) => ({ start: span.start + at, end: span.end + at }));
}

/**
 * Writes the merged manifest through a temporary file.
 *
 * The same three lines `editor-project.ts` uses, for a sharper reason: a
 * truncated `project.json` is a lost edit, and a truncated `session.json` is a
 * recording that will not open at all.
 */
function writeManifest(dir: string, manifest: Manifest): boolean {
  const path = join(dir, MANIFEST_FILE_NAME);
  const temporary = `${path}.tmp`;

  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2));
    renameSync(temporary, path);
    return true;
  } catch (cause) {
    console.error(`[session] could not write ${path}:`, cause);
    try {
      unlinkSync(temporary);
    } catch {
      // Nothing to clean up.
    }
    return false;
  }
}

/**
 * Appends a clip for the new footage, and returns its id.
 *
 * At the end of the running order, which is both where "add a recording" means
 * and the only place the source clock allows: segments are laid end to end, so
 * the new footage's source range is always the tail. Where the *clip* sits on
 * the timeline is free, and the end is next to where the user was working.
 *
 * With no overrides, deliberately. An override is a decision about one moment,
 * and repeating the previous clip's onto footage the user has not seen yet looks
 * like a bug in the background picker rather than a convenience.
 */
function appendSlice(dir: string, manifest: Manifest, at: number): string {
  // Through `loadProject` so the take's own seam is applied on the way in: the
  // saved project predates it, and a clip spanning it would play the wrong take.
  const project = loadProject(dir, manifest.id, manifest.duration, undefined, seamsOf(manifest));
  const slices = project.tracks[0]?.slices ?? [];

  // A recording nobody has edited has no `project.json`, so `loadProject` builds
  // a fresh one — which is already one clip per take, the new one included.
  // Appending a second clip over the same footage would show the addition twice.
  const already = slices.find((slice) => slice.source.end > at);
  if (already) return already.id;

  const id = `take-${String(manifest.takes.length)}`;

  saveProject(dir, {
    ...project,
    tracks: [
      {
        id: project.tracks[0]?.id ?? "composite",
        kind: "composite",
        slices: [
          ...slices,
          { id, source: { start: at, end: manifest.duration }, speed: 1, overrides: {} },
        ],
      },
    ],
  });
  // Flushed rather than left to the debounce: the editor is about to read this
  // file back, and a save still in flight would hand it the project as it was
  // before the take was added.
  flushProject(dir);

  return id;
}
