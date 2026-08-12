/**
 * The edit: what was kept, and how it should look and sound.
 *
 * Also a file format — this is what `project.json` holds — so it carries a
 * version and is sanitised on the way in, the same discipline `session.json`
 * and the preferences file already follow.
 *
 * Deliberately free of any `electron` or Node import: main persists it, the
 * renderer edits it, and the exporter is handed what it resolves to.
 */
import type { MediaTime } from "./manifest.js";
import { DEFAULT_PRESET_ID, evenSize } from "./presets.js";

export const PROJECT_VERSION = 1;
export const PROJECT_FILE_NAME = "project.json";

/** Nanoseconds, matching the manifest's `MediaTime`. */
export type Ns = MediaTime;

// ── Settings ────────────────────────────────────────────────────────────────
//
// Every setting is a flat leaf. That is not a style choice: "is this
// overridden?" is answered by `key in overrides.section`, and a nested group
// would make that mean "something in this group is overridden" — so the reset
// button next to one control would silently clear its neighbours too.
//
// Geometry is stored as a fraction of the frame's shorter edge, never in
// pixels, so switching a 16:9 frame to 9:16 does not turn 40px of padding into
// a hairline.

export type ScreenFit = "contain" | "cover";
/**
 * `wide` keeps the camera's own proportions and only rounds its corners; every
 * other shape is a square the source is centre-cropped into.
 */
export type CameraShape = "circle" | "squircle" | "rounded" | "wide";
export type CameraCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface LayoutSettings {
  screenFit: ScreenFit;
  /** 1 fits the frame; above that crops in. */
  screenZoom: number;
  screenOffsetX: number;
  screenOffsetY: number;
  cameraVisible: boolean;
  cameraShape: CameraShape;
  cameraSize: number;
  /**
   * How far into the camera's own picture to crop.
   *
   * 1 shows all of it; above that tightens in on the middle, which is how a
   * webcam sitting too far back is made to look like a headshot. Distinct from
   * `cameraSize`, which is how big the bubble is on screen — one changes the
   * shot, the other changes the frame it sits in.
   */
  cameraZoom: number;
  /**
   * Where the bubble's *centre* sits, as a fraction of the frame.
   *
   * The centre rather than a corner, for the same reason the recorder stores
   * the bubble's position that way: resizing grows it from the middle, so a
   * corner would drift every time the size changed.
   *
   * A free position rather than one of four corners — the bubble is dragged
   * around the preview, and a corner plus a margin cannot express "just off
   * centre, over the empty half of the slide".
   */
  cameraX: number;
  cameraY: number;
  /**
   * Mirrored by default, because the bubble the user watched while recording
   * was mirrored. An un-mirrored edit reads as flipped against the take.
   */
  cameraMirror: boolean;
  /**
   * Draw the pointer over the screen recording.
   *
   * Only possible when the recording was captured with the system cursor
   * switched off — otherwise the pointer is part of the picture and this would
   * put a second one on top of it. The editor hides the control in that case
   * rather than letting the setting quietly do nothing.
   */
  cursorVisible: boolean;
  /** Pointer height, as a fraction of the frame's shorter edge. */
  cursorSize: number;
  /**
   * Hide the pointer once it has been still for a while.
   *
   * A pointer parked in the middle of a slide for thirty seconds is the thing
   * a viewer's eye keeps returning to, and it is saying nothing. It comes back
   * the instant it moves.
   */
  cursorAutoHide: boolean;
  /** How long it has to be still first, in seconds. */
  cursorHideAfter: number;
}

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  /** `path` is relative to the session directory — the image is copied in, so a
      recording stays self-contained and exports the same video tomorrow. */
  | { kind: "image"; source: "wallpaper" | "file" | "preset"; path: string };

export interface BackgroundSettings {
  /** The one setting that is not a flat leaf: a discriminated union only makes
      sense as a whole, so it is treated as a single key. */
  background: Background;
  padding: number;
  cornerRadius: number;
  borderWidth: number;
  borderColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowY: number;
}

export interface AudioSettings {
  micVolume: number;
  micMuted: boolean;
  systemVolume: number;
  systemMuted: boolean;
}

export interface SliceSettings {
  layout: LayoutSettings;
  background: BackgroundSettings;
  audio: AudioSettings;
}

export type SettingsSection = keyof SliceSettings;

export type SliceOverrides = {
  [K in SettingsSection]?: Partial<SliceSettings[K]>;
};

// ── Project ─────────────────────────────────────────────────────────────────

export interface Slice {
  id: string;
  /** Half-open range of source time, on the manifest's clock. */
  source: { start: Ns; end: Ns };
  overrides: SliceOverrides;
}

/** Room for independent audio and overlay tracks later; only one kind today. */
export type ProjectTrackKind = "composite";

export interface ProjectTrack {
  id: string;
  kind: ProjectTrackKind;
  slices: Slice[];
}

/**
 * A span of the recording that is zoomed into.
 *
 * A separate list rather than another `ProjectTrack`: a track carries media
 * slices with inherited settings, and this carries neither. It is a track only
 * in the timeline's sense of the word — a row you can put things on.
 *
 * The span *includes* its transitions. Easing in before the slice starts would
 * mean a zoom that visibly begins outside the thing that describes it, and
 * trimming its edge would then move something that already happened.
 */
export interface ZoomSlice {
  id: string;
  /** Half-open range of source time, on the recording's own timeline. */
  source: { start: Ns; end: Ns };
  /**
   * `cursor` keeps the pointer in the middle of the shot for the whole span;
   * `typing` frames whatever field has keyboard focus; `region` holds still on
   * a place picked in advance.
   *
   * `typing` falls back to the pointer wherever nothing was focused — which is
   * most of a recording, and all of one made without the Accessibility grant.
   */
  target: "cursor" | "region" | "typing";
  /** Centre of the region, as fractions of the frame. Ignored for `cursor`. */
  x: number;
  y: number;
  /** How far in. 2 shows half the width and half the height. */
  level: number;
  /** Seconds the move in and the move out each take. */
  speed: number;
  /**
   * Pitch, in degrees. Positive leans the top of the picture away.
   *
   * A perspective tilt rather than a rotation: the far edge is genuinely
   * further away, so it is drawn smaller and the picture converges. That is
   * what makes it read as a camera looking at a screen rather than as a flat
   * image on a slant.
   */
  tilt: number;
  /** Yaw, in degrees. Positive swings the right edge away. */
  yaw: number;
}

export const DEFAULT_ZOOM = {
  target: "cursor",
  x: 0.5,
  y: 0.5,
  level: 2,
  // Long enough to read as a camera move rather than a cut, short enough not to
  // spend the first second of a two-second zoom still arriving.
  speed: 0.6,
  tilt: 0,
  yaw: 0,
} as const;

/** How long a zoom is when it is first dropped on the timeline. */
export const DEFAULT_ZOOM_LENGTH: Ns = 2_000_000_000;

export interface OutputSettings {
  fps: number;
  /** `"h264"` or `"hevc"`. */
  codec: string;
}

export interface Project {
  version: number;
  /** The manifest `id` this edits. A project beside a different recording is
      worth catching rather than silently applying. */
  recordingId: string;
  frame: { width: number; height: number; presetId: string | null };
  /** Every slice inherits from these. */
  defaults: SliceSettings;
  tracks: ProjectTrack[];
  /** Zoom spans, in source time. Sorted, and never overlapping. */
  zooms: ZoomSlice[];
  output: OutputSettings;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_LAYOUT: LayoutSettings = {
  screenFit: "contain",
  screenZoom: 1,
  screenOffsetX: 0,
  screenOffsetY: 0,
  cameraVisible: true,
  cameraShape: "circle",
  cameraSize: 0.22,
  cameraZoom: 1,
  // Bottom left, which is where the corner default used to put it.
  cameraX: 0.15,
  cameraY: 0.85,
  cameraMirror: true,
  cursorVisible: true,
  // About the size the pointer appears on screen in a 1080p frame, so an export
  // looks like the recording rather than like a diagram of it.
  cursorSize: 0.035,
  cursorAutoHide: false,
  cursorHideAfter: 2,
};

/** The wallpaper file main copies into a recording. */
export const WALLPAPER_FILE_NAME = "background.png";

/**
 * What a background falls back to when the desktop picture cannot be captured.
 *
 * Kept separate from `DEFAULT_BACKGROUND` because main substitutes it while
 * building a fresh project, and a missing image would otherwise render as a
 * flat placeholder that looks like a bug.
 */
export const FALLBACK_BACKGROUND: Background = {
  kind: "gradient",
  from: "#5433ff",
  to: "#20bdff",
  angle: 135,
};

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  // The user's own desktop, because a screen recording sitting on the wallpaper
  // it was taken against reads as one image rather than as a screenshot pasted
  // onto something. Main captures it when a recording is first opened, and
  // falls back to `FALLBACK_BACKGROUND` if it cannot.
  background: { kind: "image", source: "wallpaper", path: WALLPAPER_FILE_NAME },
  padding: 0.06,
  cornerRadius: 0.02,
  borderWidth: 0,
  borderColor: "#ffffff",
  shadowOpacity: 0.45,
  shadowBlur: 0.05,
  shadowY: 0.015,
};

export const DEFAULT_AUDIO: AudioSettings = {
  micVolume: 1,
  micMuted: false,
  systemVolume: 1,
  systemMuted: false,
};

export const DEFAULT_SETTINGS: SliceSettings = {
  layout: DEFAULT_LAYOUT,
  background: DEFAULT_BACKGROUND,
  audio: DEFAULT_AUDIO,
};

/**
 * Repairs a stored zoom list.
 *
 * Clamped to the recording, sorted, and stripped of anything that overlaps what
 * came before it. Overlaps are the one thing that cannot be rendered — two
 * zooms covering the same moment have no defined answer — so they are dropped
 * here rather than guarded at every point that reads the list.
 */
function zoomTarget(stored: unknown): ZoomSlice["target"] {
  return stored === "region" || stored === "typing" ? stored : "cursor";
}

function sanitiseZooms(stored: unknown, duration: Ns): ZoomSlice[] {
  if (!Array.isArray(stored)) return [];

  const zooms = (stored as Record<string, never>[])
    .map((zoom, index) => ({
      id: typeof zoom?.["id"] === "string" ? (zoom["id"] as string) : `zoom-${index}`,
      source: {
        start: clamp(number((zoom?.["source"] as never)?.["start"], 0), 0, duration),
        end: clamp(number((zoom?.["source"] as never)?.["end"], 0), 0, duration),
      },
      target: zoomTarget(zoom?.["target"]),
      x: clamp(number(zoom?.["x"], DEFAULT_ZOOM.x), 0, 1),
      y: clamp(number(zoom?.["y"], DEFAULT_ZOOM.y), 0, 1),
      level: clamp(number(zoom?.["level"], DEFAULT_ZOOM.level), 1, 8),
      speed: clamp(number(zoom?.["speed"], DEFAULT_ZOOM.speed), 0, 5),
      // Past about thirty degrees the far edge is short enough that the
      // picture is more foreshortening than content.
      tilt: clamp(number(zoom?.["tilt"], DEFAULT_ZOOM.tilt), -30, 30),
      yaw: clamp(number(zoom?.["yaw"], DEFAULT_ZOOM.yaw), -30, 30),
    }))
    .filter((zoom) => zoom.source.end > zoom.source.start)
    .sort((a, b) => a.source.start - b.source.start);

  return zooms.filter(
    (zoom, index) => index === 0 || zoom.source.start >= zooms[index - 1]!.source.end,
  );
}

/**
 * A fresh project for a recording that has never been edited.
 *
 * The frame opens on `auto`, which carries no size of its own — the editor
 * fills it in from the screen track as soon as the recording is open. These
 * dimensions are only what it holds until then, and are what it keeps if the
 * recording turns out to have no screen track to measure.
 */
export function newProject(recordingId: string, duration: Ns): Project {
  return {
    version: PROJECT_VERSION,
    recordingId,
    frame: { width: 1920, height: 1080, presetId: DEFAULT_PRESET_ID },
    defaults: structuredClone(DEFAULT_SETTINGS),
    zooms: [],
    tracks: [
      {
        id: "composite",
        kind: "composite",
        slices: [{ id: "take", source: { start: 0, end: duration }, overrides: {} }],
      },
    ],
    output: { fps: 60, codec: "h264" },
  };
}

// ── Inheritance ─────────────────────────────────────────────────────────────

/**
 * A slice's effective settings.
 *
 * One level, shallow merge per section. Anything deeper would make "overridden"
 * ambiguous, which is the whole reason the settings are flat.
 */
export function resolveSettings(
  defaults: SliceSettings,
  overrides: SliceOverrides | undefined,
): SliceSettings {
  return {
    layout: { ...defaults.layout, ...overrides?.layout },
    background: { ...defaults.background, ...overrides?.background },
    audio: { ...defaults.audio, ...overrides?.audio },
  };
}

/**
 * Which keys in a section this slice sets for itself.
 *
 * The single predicate behind the override dot, the per-control reset and the
 * section reset — so all three can never disagree about what is overridden.
 */
export function overriddenKeys<S extends SettingsSection>(
  overrides: SliceOverrides | undefined,
  section: S,
): Set<keyof SliceSettings[S]> {
  return new Set(Object.keys(overrides?.[section] ?? {}) as (keyof SliceSettings[S])[]);
}

/**
 * Sets one key as an override on a slice.
 *
 * Always records it, even when the value equals the default. Anything cleverer
 * means an edit the user made is silently not stored, and the next change to
 * the project defaults moves a slice they had already decided about.
 */
export function setOverride<S extends SettingsSection, K extends keyof SliceSettings[S]>(
  overrides: SliceOverrides,
  section: S,
  key: K,
  value: SliceSettings[S][K],
): SliceOverrides {
  return { ...overrides, [section]: { ...overrides[section], [key]: value } };
}

/** Clears one overridden key, so the slice follows the project default again. */
export function clearOverride<S extends SettingsSection>(
  overrides: SliceOverrides,
  section: S,
  key: keyof SliceSettings[S],
): SliceOverrides {
  const current = overrides[section];
  if (!current || !(key in current)) return overrides;

  const { [key as string]: _dropped, ...rest } = current as Record<string, unknown>;
  const next = { ...overrides };

  // An empty section is removed rather than left as `{}`, so "does this slice
  // override anything?" stays a simple emptiness check.
  if (Object.keys(rest).length === 0) delete next[section];
  else next[section] = rest as SliceOverrides[S];

  return next;
}

/** Clears a whole section's overrides. */
export function clearSection(overrides: SliceOverrides, section: SettingsSection): SliceOverrides {
  if (!overrides[section]) return overrides;
  const next = { ...overrides };
  delete next[section];
  return next;
}

export function hasOverrides(overrides: SliceOverrides | undefined): boolean {
  return Object.values(overrides ?? {}).some(
    (section) => section && Object.keys(section).length > 0,
  );
}

// ── Reading a stored project ────────────────────────────────────────────────

/**
 * Repairs a project read off disk.
 *
 * A hand-edited or partially-written `project.json` must not brick the editor:
 * anything unrecognised falls back to a default rather than throwing, and only
 * a version mismatch is fatal. Same posture as the preferences file.
 *
 * Returns null when the file cannot be used at all, so the caller can start
 * fresh instead of guessing.
 */
export function sanitiseProject(value: unknown, recordingId: string, duration: Ns): Project | null {
  if (typeof value !== "object" || value === null) return null;

  const stored = value as Partial<Project>;
  if (stored.version !== PROJECT_VERSION) return null;
  // A project beside a different recording would apply cuts measured against a
  // timeline this take does not have.
  if (stored.recordingId !== recordingId) return null;

  const fresh = newProject(recordingId, duration);

  const width = evenSize(number(stored.frame?.width, fresh.frame.width));
  const height = evenSize(number(stored.frame?.height, fresh.frame.height));

  const slices = (stored.tracks?.[0]?.slices ?? [])
    .filter((slice): slice is Slice => typeof slice?.id === "string")
    .map((slice) => ({
      id: slice.id,
      source: {
        start: clamp(number(slice.source?.start, 0), 0, duration),
        end: clamp(number(slice.source?.end, duration), 0, duration),
      },
      overrides: (slice.overrides ?? {}) as SliceOverrides,
    }))
    // A slice that survived clamping as empty cannot be drawn or rendered.
    .filter((slice) => slice.source.end > slice.source.start);

  return {
    version: PROJECT_VERSION,
    recordingId,
    frame: { width, height, presetId: stored.frame?.presetId ?? null },
    zooms: sanitiseZooms(stored.zooms, duration),
    defaults: {
      layout: { ...DEFAULT_LAYOUT, ...stored.defaults?.layout },
      background: { ...DEFAULT_BACKGROUND, ...stored.defaults?.background },
      audio: { ...DEFAULT_AUDIO, ...stored.defaults?.audio },
    },
    tracks: [
      {
        id: "composite",
        kind: "composite",
        // Everything cut away is recoverable by adding slices back; a project
        // with none at all is not something the editor can show.
        slices: slices.length > 0 ? slices : fresh.tracks[0]!.slices,
      },
    ],
    output: {
      fps: clamp(number(stored.output?.fps, 60), 1, 120),
      codec: stored.output?.codec === "hevc" ? "hevc" : "h264",
    },
  };
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
