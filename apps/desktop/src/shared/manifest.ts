/**
 * The TypeScript side of `session.json`.
 *
 * A structural mirror of `crates/prequel-session/src/manifest.rs`, which owns
 * the format. Field names are snake_case because that is what serde writes, and
 * renaming them here would mean a translation layer whose only job would be to
 * drift from the Rust it mirrors.
 *
 * Deliberately free of any `electron` or Node import: main reads it off disk,
 * the renderer receives it over IPC, and both need the same types.
 */

/** Nanoseconds on the session clock. Mirrors `MediaTime`. */
export type MediaTime = number;

/**
 * Bumped in Rust whenever the shape changes incompatibly.
 *
 * Checked rather than assumed, so an old recording opened by a newer build
 * fails loudly instead of being edited — and exported — as something it is not.
 *
 * 2 turned a track into a list of segments laid end to end on one session
 * clock, because a recording can be extended with a second take. A v1 manifest
 * still opens — `upgradeV1` reads it and its single file becomes a one-segment
 * list.
 */
export const MANIFEST_VERSION = 2;

export const MANIFEST_FILE_NAME = "session.json";

export type TrackKind = "screen" | "camera" | "microphone" | "system_audio";

/**
 * Every kind, in the order the recorder writes them.
 *
 * A list as well as the union, so anything that has to visit each kind — the
 * export's per-slice media refs, the mixer's buses — iterates one definition
 * rather than repeating the four names.
 */
export const TRACK_KINDS: readonly TrackKind[] = ["screen", "camera", "microphone", "system_audio"];

/** The file each kind is written to, inside a session directory. */
export const TRACK_FILE_NAMES: Record<TrackKind, string> = {
  screen: "screen.mp4",
  camera: "camera.mp4",
  microphone: "mic.m4a",
  system_audio: "system.m4a",
};

/**
 * The camera's person matte, recorded beside `camera.mp4`.
 *
 * Written at record time by the camera pipeline: one grayscale frame per
 * camera frame, luma being alpha, at whatever size the segmentation model
 * works in. Nothing lays out against `width` and `height` — both rasterisers
 * sample the mask with the picture's own normalised coordinates, which is why
 * the size need not match the camera's.
 */
export interface Matte {
  file_name: string;
  width: number;
  height: number;
  samples: number;
  /** Camera frames with no mask of their own; the previous mask stands in. */
  dropped: number;
}

/**
 * Where the camera pipeline writes the matte. Only the fake recorder writes
 * with this name — every reader takes `Track.matte.file_name` from the
 * manifest, so the constant on the Rust side is the one that matters.
 */
export const CAMERA_MATTE_FILE_NAME = "camera-matte.mp4";

/**
 * One take's worth of one track: a file, and where it sits on the session clock.
 *
 * The file itself is always zero-based — `VideoWriter` opens its session at the
 * first sample's PTS — so `start` is the only record of a late device, and it is
 * per file rather than per track because take two's camera opens a couple of
 * hundred milliseconds after take two's screen, exactly as take one's did.
 */
export interface Segment {
  /**
   * Relative to the session directory: `"screen.mp4"` for the first take,
   * `"2/screen.mp4"` for the second. A path rather than a bare name because
   * each take is captured into its own subdirectory, under the fixed names of
   * `TRACK_FILE_NAMES`.
   */
  file_name: string;
  /**
   * Media time of this file's first sample.
   *
   * Non-zero when a device took longer to warm up than the one that anchored
   * the clock — the camera routinely opens a few hundred milliseconds late.
   * This is the offset that has to be honoured to keep the tracks in sync.
   */
  start: MediaTime;
  /** Media time just past this file's last sample. */
  end: MediaTime;
  width?: number;
  height?: number;
  samples: number;
  /** Samples the timing guard rejected. A large count points at a struggling
      capture pipeline, but is not itself a failure. */
  dropped: number;
  /**
   * Only ever on a camera segment, and only when segmentation was available
   * while recording. Absent on every recording made before it existed — a
   * camera with no matte, which is what those recorded.
   */
  matte?: Matte;
}

export interface Track {
  kind: TrackKind;
  /**
   * In session-clock order, never empty, never overlapping. One entry per take
   * that recorded this kind — a take with the microphone switched off simply
   * contributes none, so a track can stop before the recording does.
   */
  segments: Segment[];
}

/**
 * One recording session inside this project. The seam list, and nothing else.
 *
 * Explicit rather than derived from a track's segment boundaries, because those
 * disagree per track by however long each device took to open. A slice may not
 * span a seam, and if "where is the seam" has two answers the per-slice segment
 * lookup reads the wrong take's file for the first frames of a clip.
 */
export interface Take {
  /**
   * Subdirectory the take's files are in, relative to the session directory.
   * Empty for the first take, whose files sit at the root.
   */
  dir?: string;
  start: MediaTime;
  end: MediaTime;
}

/** A rectangle in the display's own points. See `SourceInfo.crop`. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceInfo {
  /**
   * `"display"`, `"area"` or `"window"`.
   *
   * `area` is a display capture with a crop, which ScreenCaptureKit cannot
   * distinguish from a whole screen afterwards — the crop is applied during
   * capture and never written down. Recordings made before the recorder told
   * the two apart say `display` for both, so an old area grab opens framed as
   * a whole screen. That only decides the defaults of a project nobody has
   * edited yet, which is a wrong first impression rather than a wrong edit.
   */
  kind: string;
  id: number;
  title: string;
  app_name?: string;
  scale_factor: number;
  /**
   * A recorded window's own corner radius, in pixels of the screen track.
   *
   * The capture leaves a window's rounded corners transparent and the file
   * has them black, so a picture rounded less than this shows a wedge between
   * its border and its edge. Measured at record time; absent for a display,
   * for a window it could not be read from, and on every recording made
   * before it was measured. Absent is "not known", never "square" — the
   * project keeps its stock radius rather than dropping to zero.
   */
  corner_radius?: number;
  /**
   * The region an area capture was cropped to, in the display's own points.
   *
   * Recorded so a second take of the same area can reproduce the framing.
   * Absent for a display, for a window, and on every recording made before it
   * was written down — where the area picker opens with nothing pre-dragged
   * rather than guessing.
   */
  crop?: Region;
}

/**
 * A cursor position sampled during the recording.
 *
 * `x` and `y` are fractions of the captured frame, not pixels and not screen
 * points: everything needed to convert them — the display's origin, the crop,
 * the scale — is known only during capture. Recordings written before the
 * pointer became a layer hold raw points here instead, which is safe only
 * because `cursor_baked` is true for all of them and a baked pointer is never
 * drawn from the track.
 */
/**
 * Which pointer the system was showing.
 *
 * `arrow` is everything unrecognised as well as the arrow itself, which is why
 * it is the one the manifest leaves out — the pointer is an arrow for nearly all
 * of a recording, and writing it beside every one of tens of thousands of
 * samples is pure file size.
 */
export type CursorKind = "arrow" | "hand" | "text" | "resize-h" | "resize-v";

export interface CursorSample {
  at: MediaTime;
  x: number;
  y: number;
  /**
   * Which pointer the system was showing here. Absent means the arrow.
   *
   * The editor swaps images over the spans this changes across, so a composited
   * pointer becomes an I-beam in a text field the way the real one did — without
   * it a recording never changes shape at all, which is the tell that the
   * pointer was drawn in afterwards.
   */
  kind?: CursorKind;
  /**
   * What `kind` replaced, and the only thing recordings made before it carry.
   *
   * Read rather than written. `cursorKind` in `layout.ts` falls back to this
   * where there is no `kind`, which is the one place either is looked at.
   */
  hand?: boolean;
}

/** A press, sampled during the recording. */
export interface ClickSample {
  at: MediaTime;
  x: number;
  y: number;
}

/**
 * A stretch of the recording somebody was typing through.
 *
 * The coarse record: when typing started and when it stopped, rounded to a
 * tenth of a second, with runs of fewer than three presses left out entirely.
 * No key, no count. The pointer is hidden through these, and still is when
 * `key_presses` are present — so a recording made with presses switched off
 * behaves the same.
 */
export interface KeySpan {
  start: MediaTime;
  end: MediaTime;
}

/**
 * The kind of key a press was, as coarsely as a sound needs.
 *
 * Five classes, chosen by what sounds different on a real board: the space
 * bar, Return and Delete sit on stabilisers and sound bigger than a letter; a
 * modifier is pressed softer. Everything else — letters, digits, punctuation,
 * arrows, function keys — is `letter`.
 */
export type KeyClass = "letter" | "space" | "enter" | "backspace" | "modifier";

/**
 * One key press: when, and which class of key. Never a key code, never a
 * character, never the release. See `Manifest.key_presses`.
 */
export interface KeyPress {
  at: MediaTime;
  class: KeyClass;
}

/** A focused text area, sampled during the recording. */
export interface TypingSample {
  at: MediaTime;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Manifest {
  version: number;
  id: string;
  /** Wall-clock start, ISO 8601. For display only — never for synchronisation. */
  started_at: string;
  /** Recording length with paused spans already removed. */
  duration: MediaTime;
  /**
   * The first take's. Nothing reads it per moment — `sourceShape` turns it into
   * project defaults once, when the project is created — and a second take of a
   * different display would describe itself differently.
   */
  source: SourceInfo;
  tracks: Track[];
  /**
   * Every recording that went into this session, in clock order. Never empty
   * after `parseManifest`, which synthesises one for a v1 manifest. Laid end to
   * end, so a take begins exactly where the last one ended.
   */
  takes: Take[];
  /**
   * Whether ScreenCaptureKit drew the pointer into the frames.
   *
   * Absent on recordings made before the pointer became a layer, and true is
   * what they all did — so it is read with `?? true`, never `?? false`. Getting
   * it the wrong way round puts two pointers in the export.
   */
  cursor_baked?: boolean;
  /** Empty unless the capture sampled the cursor. */
  cursor?: CursorSample[];
  /**
   * Where text was being typed, as fractions of the captured frame.
   *
   * Bounds of the field that had keyboard focus — never a keystroke, and never
   * what was typed. Empty without the Accessibility grant, and empty for every
   * recording made before it was asked for.
   */
  typing?: TypingSample[];
  /**
   * Where the pointer was pressed, as fractions of the captured frame.
   *
   * Buttons only — never which key, never what was typed. The editor's first
   * cut is built from these: a click says what mattered and when far more
   * clearly than where the pointer travelled.
   */
  clicks?: ClickSample[];
  /**
   * When somebody was typing — never a key, and never what was typed.
   *
   * Absent on every recording made before the pointer learned to get out of the
   * way, which is why nothing downstream may treat an empty list as "nobody
   * typed" rather than "this recording does not say".
   */
  keys?: KeySpan[];
  /**
   * The moment of each key press and roughly what kind of key it was — what
   * the editor's typing sounds are made from.
   *
   * Absent when the Keyboard switch in Settings was off, and on every
   * recording made before it existed; absent means "not recorded", not
   * "nobody typed". Passwords are absent regardless: macOS withholds key
   * events from every event tap while a secure text field has focus.
   */
  key_presses?: KeyPress[];
}

export class ManifestError extends Error {}

/**
 * Parses a manifest, refusing anything this build does not understand.
 *
 * The version check is the point: silently editing a manifest written by a
 * newer build would produce an export that is wrong in ways nothing downstream
 * could detect.
 */
export function parseManifest(text: string): Manifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new ManifestError(`session.json is not valid JSON: ${String(cause)}`);
  }

  if (typeof value !== "object" || value === null) {
    throw new ManifestError("session.json is not an object");
  }

  const manifest = value as Partial<Manifest>;
  if (!Array.isArray(manifest.tracks)) {
    throw new ManifestError("session.json has no tracks");
  }

  // Every recording made before a session could hold a second take. Its one
  // file per track is one segment, which is exactly what this shape reduces to
  // for a single take — so nothing downstream needs a special case, and the
  // upgrade is a shape change rather than a reinterpretation.
  if (manifest.version === 1) return upgradeV1(manifest as unknown as V1Manifest);

  if (manifest.version !== MANIFEST_VERSION) {
    throw new ManifestError(
      `session.json is version ${String(manifest.version)}, this build understands ${MANIFEST_VERSION}`,
    );
  }

  return manifest as Manifest;
}

/** A track as v1 wrote it: one file, with the span and size on the track. */
type V1Track = Omit<Segment, "file_name"> & { kind: TrackKind; file_name: string };

type V1Manifest = Omit<Manifest, "tracks" | "takes"> & { tracks: V1Track[] };

/**
 * A v1 manifest in the current shape, in memory only.
 *
 * Never written back. A build that rewrote a v1 recording as v2 for having
 * looked at it would make that recording unopenable by the build the user is
 * about to roll back to, for no reason at all — v2 is written by a fresh
 * capture and by the merge, and by nothing else.
 */
function upgradeV1(manifest: V1Manifest): Manifest {
  const { tracks, ...rest } = manifest;
  return {
    ...rest,
    version: MANIFEST_VERSION,
    tracks: tracks.map(({ kind, ...segment }) => ({ kind, segments: [segment] })),
    // One take, spanning the whole recording, with its files at the session
    // root — which is where a v1 recording keeps them.
    takes: [{ dir: "", start: 0, end: manifest.duration }],
  };
}

export function findTrack(manifest: Manifest, kind: TrackKind): Track | undefined {
  return manifest.tracks.find((track) => track.kind === kind);
}

/** Media time of a track's first sample, across every take. 0 when empty. */
export function trackStart(track: Track): MediaTime {
  return track.segments[0]?.start ?? 0;
}

/**
 * The seams a recording was extended at — one per take after the first.
 *
 * Read from the take table rather than from any track's segment boundaries,
 * which disagree by however long each device took to open. A slice may not span
 * one of these.
 */
export function seamsOf(manifest: Manifest): MediaTime[] {
  return manifest.takes.slice(1).map((take) => take.start);
}
