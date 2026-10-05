/**
 * Putting a recording back together after the app went away mid-take.
 *
 * A take's media is written to disk as it is captured, but what ties the files
 * together is held in memory until `stopRecording` — so a take the app never
 * got to stop leaves a directory nothing can open. The app only counts a
 * directory as a recording once it holds a `session.json`, and that is written
 * at the end.
 *
 * A marker file goes down the moment capture starts, holding the few facts the
 * media itself cannot say. This reads it, asks the files how long they turned
 * out to be, and writes the manifest the stop never got to write.
 *
 * What cannot be recovered is everything that lived only in memory: the
 * pointer track, the clicks, the typing spans, the camera's fitted outline.
 * A recovered take therefore has no automatic zooms and no pointer layer — a
 * recording somebody can still edit and export, where the alternative is a
 * folder they can only find in Finder.
 *
 * **How much this can save depends on how the app went away.** A quit, a
 * signal or a failed stop leaves finalised files and recovers whole: those
 * paths close the writers, and only the manifest is missing. A process that
 * died outright — `kill -9`, a crash in main, the power going — leaves an
 * `AVAssetWriter` that never wrote its `moov` atom, and no decoder will open
 * what it left. Those files are kept rather than deleted, and the log says
 * where they are, because nothing here can turn them back into a recording.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { Manifest, Segment, SourceInfo, Track, TrackKind } from "../shared/manifest.js";
import {
  CAMERA_MATTE_FILE_NAME,
  MANIFEST_FILE_NAME,
  MANIFEST_VERSION,
  TRACK_FILE_NAMES,
} from "../shared/manifest.js";
import { log } from "./log.js";
import { getRecorder, type TrackProbe } from "./recorder.js";

/**
 * The marker that says a capture is under way in this directory.
 *
 * Its own file rather than an early `session.json`, deliberately. "A directory
 * is a recording when it has a manifest" is the rule the library, the merge and
 * the editor all rest on, and a manifest describing a take still being written
 * would put a half-recorded tile in the grid and offer it to the editor. The
 * marker is invisible to all of them, and it is this module's whole input.
 */
export const CAPTURE_MARKER_FILE_NAME = "capturing.json";

/** What the manifest needs that the media files cannot say for themselves. */
export interface CaptureMarker {
  /** Wall-clock start, ISO 8601, as `Manifest.started_at` carries it. */
  started_at: string;
  source: SourceInfo;
  /** Whether ScreenCaptureKit drew the pointer into the frames. */
  cursor_baked: boolean;
}

/**
 * Says a capture is under way in `dir`.
 *
 * Written after the recorder has started rather than before: the capture crates
 * create the directory they are handed, so there is nowhere to put this until
 * the first file is in it.
 */
export function markCapturing(dir: string, marker: CaptureMarker): void {
  try {
    // The capture crates have already made this, every time. Made again here
    // so the marker does not depend on that ordering — a recorder that got as
    // far as a running stream with no directory would be a take nobody could
    // recover, for want of one syscall.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, CAPTURE_MARKER_FILE_NAME), JSON.stringify(marker, null, 2));
  } catch (cause) {
    // Not fatal to the recording, which is already running and writing frames.
    // It only means a crash in the next few minutes would leave this take for
    // somebody to find in Finder, which is where every take was before this.
    console.warn(`[recover] could not mark ${dir} as capturing:`, cause);
  }
}

/** Says the capture in `dir` finished, and wrote its own manifest. */
export function clearCapturing(dir: string): void {
  try {
    rmSync(join(dir, CAPTURE_MARKER_FILE_NAME), { force: true });
  } catch (cause) {
    // A marker left behind is picked up by the next recovery pass, which finds
    // the `session.json` beside it and removes it. Harmless either way.
    console.warn(`[recover] could not clear the marker in ${dir}:`, cause);
  }
}

/**
 * Finishes every take the app was part way through when it last stopped.
 *
 * Returns the directories it wrote a manifest for. Handed the library rather
 * than reaching for it, so this module imports nothing from `session.ts` —
 * which imports this one to write the marker. Run once at startup, before
 * anything lists the library, and never while a recording is in progress: that
 * is an interrupted take as far as this can tell, and it would be rewritten
 * underneath the recorder still writing it.
 *
 * Never throws. Each take is recovered on its own: one unreadable directory
 * must not cost the others, and a recovery pass that fails is a recovery pass
 * nobody knows happened.
 */
export async function recoverInterruptedTakes(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (cause) {
    console.warn(`[recover] could not read ${dir}:`, cause);
    return [];
  }

  // Every candidate is found before anything is awaited, and that ordering is
  // load-bearing: the user can start recording while this is still probing,
  // and a take that began after the pass did is one it would otherwise find
  // mid-write — with no manifest, exactly like an interrupted one — and delete
  // underneath the recorder. A list taken synchronously cannot hold a
  // directory that does not exist yet.
  const candidates = entries.flatMap((name) => capturingDirs(join(dir, name)));

  const recovered: string[] = [];
  for (const candidate of candidates) {
    try {
      if (await recoverTake(candidate)) recovered.push(candidate);
    } catch (cause) {
      console.error(`[recover] could not recover ${candidate}:`, cause);
    }
  }

  if (recovered.length > 0) log("info", `recovered ${recovered.length} interrupted take(s)`);
  return recovered;
}

/**
 * The directories under one recording that hold a marker.
 *
 * The recording's own, and any numbered take inside it: a crash while adding
 * footage to an existing recording leaves the base `session.json` untouched and
 * an unfinished take beside it. Recovering that take to its own manifest is
 * enough — `mergeUnmergedTakes` folds it into the recording on the next open,
 * which is the same path an orphan take from a failed merge takes.
 */
function capturingDirs(recording: string): string[] {
  const found: string[] = [];
  if (existsSync(join(recording, CAPTURE_MARKER_FILE_NAME))) found.push(recording);

  let takes: string[] = [];
  try {
    takes = readdirSync(recording).filter((name) => /^\d+$/.test(name));
  } catch {
    // Not a directory, or not readable. Neither is a recording.
    return found;
  }

  for (const take of takes) {
    if (existsSync(join(recording, take, CAPTURE_MARKER_FILE_NAME))) {
      found.push(join(recording, take));
    }
  }
  return found;
}

/**
 * How much media a directory has to hold before it is worth keeping unopenable.
 *
 * A second of screen capture is a megabyte or two, so this is "somebody
 * recorded something". Below it the folder holds a container header and no
 * frames, which is what a take abandoned in its first moment leaves.
 */
const ORPHAN_LIMIT = 1_000_000;

/** Whether this directory came back as something openable. */
async function recoverTake(dir: string): Promise<boolean> {
  // The stop got there after all — it wrote the manifest and died before
  // clearing the marker. Nothing to rebuild, and rebuilding would replace a
  // manifest holding a whole pointer track with one holding none.
  if (existsSync(join(dir, MANIFEST_FILE_NAME))) {
    clearCapturing(dir);
    return false;
  }

  const probes = await (await getRecorder()).probeSession(dir);
  const usable = probes.filter((probe) => probe.duration > 0);
  if (usable.length === 0) {
    // Nothing here opens. Either the take never got going, or the process died
    // with its writers mid-file — see the note at the top of this module on
    // which is which. The difference on disk is size, and it decides what
    // happens next: an empty shell is swept up, and megabytes of unindexed
    // video are left exactly where they are. Deleting those would be this app
    // throwing away the only copy of something it merely cannot read.
    if (bytes(dir) > ORPHAN_LIMIT) {
      log("warn", `an interrupted take could not be reassembled, keeping it: ${dir}`);
    } else {
      log("info", `discarding an interrupted take with no media in it: ${dir}`);
      rmSync(dir, { recursive: true, force: true });
    }
    clearCapturing(dir);
    return false;
  }

  write(dir, rebuild(dir, readMarker(dir), usable));
  clearCapturing(dir);
  log("info", `recovered an interrupted take: ${dir}`, {
    tracks: usable.map((probe) => probe.kind),
  });
  return true;
}

/**
 * The marker, or what to assume when it is not there to read.
 *
 * A take with unreadable accompanying JSON is still a take. Every field here
 * only affects how the editor frames the recording the first time it is opened
 * — and framing somebody can change beats a recording they cannot open.
 */
function readMarker(dir: string): CaptureMarker {
  try {
    const marker = JSON.parse(
      readFileSync(join(dir, CAPTURE_MARKER_FILE_NAME), "utf8"),
    ) as Partial<CaptureMarker>;
    if (marker.source && typeof marker.started_at === "string") {
      return {
        started_at: marker.started_at,
        source: marker.source,
        cursor_baked: marker.cursor_baked ?? false,
      };
    }
  } catch (cause) {
    console.warn(`[recover] could not read the marker in ${dir}:`, cause);
  }

  return {
    started_at: new Date().toISOString(),
    // A display rather than a window: a window capture framed as a display
    // opens edge to edge, which is wrong but harmless, where the reverse puts
    // a whole screen on a background as though it were a window.
    source: { kind: "display", id: 0, title: "", app_name: "", scale_factor: 2 },
    cursor_baked: false,
  };
}

/** The manifest the stop would have written, from the files it left behind. */
function rebuild(dir: string, marker: CaptureMarker, probes: TrackProbe[]): Manifest {
  const tracks: Track[] = probes.map((probe) => ({
    kind: probe.kind as TrackKind,
    segments: [segment(dir, probe)],
  }));

  // The screen's, where there is one: it is the track that anchors the session
  // clock, and the others are measured against it. Otherwise the longest thing
  // that was captured, so a take that lost its screen still says how long it is.
  const screen = probes.find((probe) => probe.kind === "screen");
  const duration = screen?.duration ?? Math.max(...probes.map((probe) => probe.duration));

  return {
    version: MANIFEST_VERSION,
    id: dir.split("/").pop() ?? "",
    started_at: marker.started_at,
    duration,
    source: marker.source,
    tracks,
    takes: [{ dir: "", start: 0, end: duration }],
    cursor_baked: marker.cursor_baked,
    // Everything sampled during the capture is gone: it was held in memory to
    // be written at the stop that never came. Left absent rather than faked —
    // the editor reads an absent pointer track as a recording made before the
    // pointer was sampled, which is exactly how this one should behave.
  };
}

function segment(dir: string, probe: TrackProbe): Segment {
  const file_name = TRACK_FILE_NAMES[probe.kind as TrackKind] ?? probe.fileName;

  return {
    file_name,
    // Every track is taken to have started with the screen. The real offset —
    // the few hundred milliseconds a camera takes to open — lived only in
    // memory, and the files are all written zero-based, so there is nothing
    // left on disk that remembers it. The error is bounded by how long the
    // slowest device took to open, and it is the same error for the whole take
    // rather than a drift.
    start: 0,
    end: probe.duration,
    width: probe.width ?? undefined,
    height: probe.height ?? undefined,
    // Counted off the duration rather than the file: the writer's own count
    // went with it, and nothing lays out against this — it is reported in the
    // editor's details and nowhere else.
    samples: probe.frameRate ? Math.round((probe.duration / 1e9) * probe.frameRate) : 0,
    dropped: 0,
    matte: matte(dir, probe),
  };
}

/**
 * The camera's person matte, when one was being written.
 *
 * Attached so a recovered recording keeps its background removal: the mask is
 * written beside the camera and closed with it, so a take that recovers at all
 * has both. Its fitted outline does not come back — that is sampled into the
 * manifest at ten a second and was in memory — so the bubble that follows
 * somebody falls back to a circle, which is what the editor does for every
 * recording made before the fitter existed.
 */
function matte(dir: string, probe: TrackProbe): Segment["matte"] {
  if (probe.kind !== "camera" || !existsSync(join(dir, CAMERA_MATTE_FILE_NAME))) return undefined;

  return {
    file_name: CAMERA_MATTE_FILE_NAME,
    // Nothing lays out against these: both rasterisers sample the mask with the
    // picture's own normalised coordinates, so the camera's size is a safe
    // stand-in for a size nobody reads.
    width: probe.width ?? 0,
    height: probe.height ?? 0,
    samples: 0,
    dropped: 0,
  };
}

/** Bytes of media in a directory, ignoring the marker and anything else small. */
function bytes(dir: string): number {
  try {
    return readdirSync(dir)
      .map((name) => {
        try {
          return statSync(join(dir, name)).size;
        } catch {
          return 0;
        }
      })
      .reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}

/**
 * Writes the manifest through a temporary file.
 *
 * The same discipline `editor-project.ts` uses, and for the same reason: this
 * runs at startup, and a crash-on-launch loop part way through a direct write
 * would leave a truncated `session.json` — which is worse than the no manifest
 * at all that this is here to fix.
 */
function write(dir: string, manifest: Manifest): void {
  const path = join(dir, MANIFEST_FILE_NAME);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(manifest));
  renameSync(temporary, path);
}
