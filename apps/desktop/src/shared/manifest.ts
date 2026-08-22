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
 */
export const MANIFEST_VERSION = 1;

export const MANIFEST_FILE_NAME = "session.json";

export type TrackKind = "screen" | "camera" | "microphone" | "system_audio";

/** The file each kind is written to, inside a session directory. */
export const TRACK_FILE_NAMES: Record<TrackKind, string> = {
  screen: "screen.mp4",
  camera: "camera.mp4",
  microphone: "mic.m4a",
  system_audio: "system.m4a",
};

export interface Track {
  kind: TrackKind;
  file_name: string;
  /**
   * Media time of this track's first sample.
   *
   * Non-zero when a device took longer to warm up than the one that anchored
   * the clock — the camera routinely opens a few hundred milliseconds late.
   * This is the offset that has to be honoured to keep the tracks in sync.
   */
  start: MediaTime;
  /** Media time just past this track's last sample. */
  end: MediaTime;
  width?: number;
  height?: number;
  samples: number;
  /** Samples the timing guard rejected. A large count points at a struggling
      capture pipeline, but is not itself a failure. */
  dropped: number;
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
export interface CursorSample {
  at: MediaTime;
  x: number;
  y: number;
  /**
   * Whether the system was showing the link cursor — the pointing hand.
   *
   * Absent means it was not, which is also what every recording made before the
   * shape was sampled says. The editor draws a hand for the spans this is true
   * over, so a composited pointer changes shape over a link the way the real
   * one did; without it a recording simply never grows a hand, which is the
   * behaviour it had before.
   */
  hand?: boolean;
}

/** A press, sampled during the recording. */
export interface ClickSample {
  at: MediaTime;
  x: number;
  y: number;
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
  source: SourceInfo;
  tracks: Track[];
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
  if (manifest.version !== MANIFEST_VERSION) {
    throw new ManifestError(
      `session.json is version ${String(manifest.version)}, this build understands ${MANIFEST_VERSION}`,
    );
  }
  if (!Array.isArray(manifest.tracks)) {
    throw new ManifestError("session.json has no tracks");
  }

  return manifest as Manifest;
}

export function findTrack(manifest: Manifest, kind: TrackKind): Track | undefined {
  return manifest.tracks.find((track) => track.kind === kind);
}
