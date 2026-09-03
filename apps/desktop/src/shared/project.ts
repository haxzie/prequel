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
import type { ExportFormat } from "./contract.js";
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

/**
 * A named arrangement of the two pictures.
 *
 * This is the shape of the composition, and it replaced a `contain`/`cover`
 * choice that could only ever say how the screen filled a frame it always had
 * to itself. The arrangements where the two pictures *share* the frame — beside
 * each other, stacked, split down the middle — were unreachable, because
 * neither picture was an object with a box of its own.
 *
 * `over-full` and `over-padded` own only the screen and leave the camera free,
 * which is the bubble as it has always behaved. Everything else owns both
 * boxes, `over-column` included — it stands the camera in a portrait column
 * over the right end of a padded screen, so it is an `over-*` by what the
 * camera does to the screen and not by what it leaves free. `custom` owns
 * neither and reads them off the settings; it is where a resize lands.
 *
 * A `-left` suffix says which side the *camera* takes, and nothing else: the
 * pair is one arrangement reflected, drawn by the same arithmetic through
 * `mirror` rather than by a second set of rules that could come to disagree.
 */
export type LayoutPreset =
  | "over-full"
  | "over-padded"
  | "over-column"
  | "over-column-left"
  | "beside"
  | "beside-left"
  | "stacked"
  | "split"
  | "screen-full"
  | "screen-padded"
  | "screen-inset"
  | "camera-full"
  | "camera-padded"
  | "camera-inset"
  | "custom";

/**
 * `wide` keeps the camera's own proportions and only rounds its corners,
 * `portrait` stands the same crop on end for a frame that is taller than it is
 * wide; every other shape is square. The shape sets the corner radius and nothing else —
 * picking one writes `cameraWidth`, and the geometry reads that. Deriving the
 * width from the shape instead would mean a resized bubble snapped back to a
 * square the next time anyone touched the shape control.
 */
export type CameraShape = "circle" | "squircle" | "rounded" | "wide" | "portrait";
export type CameraCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface LayoutSettings {
  preset: LayoutPreset;
  /**
   * The screen box's *centre*, as a fraction of the frame, and its size as a
   * fraction of the shorter edge. Read only under `custom`; every other preset
   * works the box out from the frame, so these hold the last dragged shape
   * without fighting it.
   *
   * The shorter edge for both edges of the box rather than width for one and
   * height for the other, so the box keeps its shape through a 16:9 -> 9:16
   * switch instead of being squashed into the new frame.
   */
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
  screenOffsetX: number;
  screenOffsetY: number;
  cameraVisible: boolean;
  cameraShape: CameraShape;
  /** The bubble's size, both edges as fractions of the frame's shorter edge. */
  cameraWidth: number;
  cameraHeight: number;
  /**
   * Dress the camera as a card rather than as a bubble. Read only under
   * `custom`; every other arrangement knows which of the two it wants.
   *
   * Carried rather than assumed, because `custom` is arrived at from both. A
   * camera dragged out of `split` was a square-cornered card standing beside
   * the screen, and one dragged out of `over-padded` was a round bubble on top
   * of it — picking either as the answer for both turns the *other* one into a
   * different shape the instant the screen is touched, which reads as the
   * camera breaking rather than as the arrangement changing.
   */
  cameraCard: boolean;
  /**
   * How far into the camera's own picture to crop.
   *
   * 1 shows all of it; above that tightens in on the middle, which is how a
   * webcam sitting too far back is made to look like a headshot. Distinct from
   * `cameraHeight`, which is how big the bubble is on screen — one changes the
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
  /** Pan within the camera's crop window, the mirror of `screenOffsetX/Y`. */
  cameraOffsetX: number;
  cameraOffsetY: number;
  /**
   * Shrink the bubble while a zoom is pushed in.
   *
   * A zoom brings the picture closer without changing the bubble, so the bubble
   * takes a larger share of a frame that has less room in it — and covers more
   * of the thing the zoom exists to show.
   *
   * Only ever applies to a camera floating *over* the screen. One of two cards
   * sharing a frame cannot shrink without leaving a hole where it was, which is
   * why `cameraFloats` in `shared/layout.ts` gates this rather than the setting
   * standing on its own.
   */
  cameraShrinkOnZoom: boolean;
  /**
   * How big the bubble gets while a zoom is in, as a fraction of its own size.
   *
   * A fraction of itself rather than of the frame, so it means the same thing
   * whatever size the bubble is — and so changing the bubble's size does not
   * silently change how far it shrinks.
   *
   * One size for every zoom, not one per zoom depth: a 4x zoom does not want a
   * smaller bubble than a 2x one, it wants the same bubble out of the way.
   */
  cameraShrinkTo: number;
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
   * How much of the recorded path's stepping to take out, from 0 to 1.
   *
   * The pointer is sampled from the video callback — 30 Hz at best, and nothing
   * at all while the screen holds still — so drawn exactly as recorded it turns
   * a corner at every sample and crosses each gap at one constant speed. This
   * is how far behind its own recording the drawn pointer is allowed to run in
   * exchange for a continuous path; 0 draws the samples as they were taken.
   */
  cursorSmoothing: number;
  /**
   * How far the pointer smears along its own travel, from 0 to 1.
   *
   * A pointer flung across the screen is drawn as crisply as one standing
   * still, which is the one thing about it that never happens in real footage —
   * and next to a smoothed path a hard sprite moving fast reads as a sticker
   * sliding over the picture rather than as something in it.
   *
   * A share of a full shutter rather than a length: the streak's length comes
   * from how fast the pointer is actually going, and what this chooses is how
   * much of that speed is allowed to show. 0 draws it as sharp as it ever was.
   */
  cursorMotionBlur: number;
  /**
   * Which pointer to draw. See `CURSOR_STYLES`.
   *
   * A tone rather than a shape: the arrow becomes a hand over anything the
   * recording says the system showed one for, so this chooses black or white,
   * not what the pointer is doing. A string rather than the union so a project
   * written by a build with styles this one does not have still loads —
   * `cursorStyle()` falls back rather than throwing.
   */
  cursorStyle: string;
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
  /**
   * Hide the pointer while somebody is typing.
   *
   * A pointer parked over a text field through a paragraph of typing is the
   * thing an eye keeps returning to while the words it should be reading go in
   * somewhere else. It comes back the moment the pointer moves, so it is never
   * missing when it is being used.
   *
   * Only recordings made once the capture started noting when typing happened
   * carry the spans this needs; an older one draws the pointer throughout
   * whatever this says.
   */
  cursorHideWhileTyping: boolean;
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
  /** How opaque the border is, 0 to 1. A tinted edge rather than a solid one. */
  borderOpacity: number;
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

/** Where a cue sits against the frame. */
export type CaptionPlace = "top" | "middle" | "bottom";

// ── Blur regions ────────────────────────────────────────────────────────────

/**
 * One rectangular region to blur in the output video.
 *
 * Coordinates are fractions of the *screen's source frame*, not of the output
 * frame. That makes a region independent of the layout arrangement — adding
 * padding or changing the composition does not move the blurred area relative
 * to the content it is hiding.
 *
 * Fractions rather than pixels for the same reason every other geometry setting
 * is: a project saved at 1080p opens at 720p and the region stays in the right
 * place.
 */
export interface BlurSlice {
  id: string;
  /** Half-open range of source time, on the recording's own timeline. */
  source: { start: Ns; end: Ns };
  /** Centre of the region, as a fraction of the source frame's width. */
  x: number;
  /** Centre of the region, as a fraction of the source frame's height. */
  y: number;
  /** Width as a fraction of the source frame's width. */
  width: number;
  /** Height as a fraction of the source frame's height. */
  height: number;
  /**
   * Gaussian sigma, as a fraction of the frame's shorter edge.
   *
   * A fraction rather than absolute pixels so the blur strength reads the same
   * at 720p and 4K — "just unreadable" is a property of the content and not of
   * the resolution it is exported at.
   */
  strength: number;
  /** 
   * Optional keyframes generated by motion tracking.
   * If present, these take precedence over the static x, y, width, height 
   * based on the current playback time.
   */
  keyframes?: BlurKeyframe[];
}

export interface BlurKeyframe {
  /** Timestamp in seconds from the start of the source video. */
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Opacity of the blur. 0 means it faded out because the object left the screen. */
  opacity: number;
}




export interface CaptionSettings {
  /**
   * Draw captions at all.
   *
   * Off by default, and off for every project saved before captions existed —
   * see `beforeCaptions`. Turning it on with no transcript draws nothing rather
   * than erroring; the panel is what offers to make one.
   */
  captionsOn: boolean;
  /**
   * Which look to draw. See `CAPTION_STYLES`.
   *
   * A string rather than the union, for the same reason `cursorStyle` is one:
   * a project written by a build with looks this one does not have still opens,
   * because `captionStyle()` falls back rather than throwing.
   */
  captionStyle: string;
  /** Cap height, as a fraction of the frame's shorter edge. */
  captionSize: number;
  captionPlace: CaptionPlace;
  /**
   * How far in from that edge, as a fraction of the shorter edge.
   *
   * Ignored by `middle`, which has no edge to be offset from.
   */
  captionOffset: number;
  /** The colour the spoken word is lit in. Looks with no lit layer ignore it. */
  captionAccent: string;
  /** How many lines a cue may fill before it breaks into another. */
  captionLines: number;
}

/**
 * What a cue's pixels depend on, as one string.
 *
 * Caption settings are per clip like every other section, but the cues are
 * *rasterised* — so two clips that agree on these five leaves can share one set
 * of bitmaps, and two that disagree need their own. Position and whether they
 * are shown at all are deliberately absent: neither changes a pixel of the
 * bitmap, so moving the captions up the frame must not redraw them.
 */
export function captionLook(captions: CaptionSettings): string {
  return [
    captions.captionStyle,
    captions.captionSize.toFixed(4),
    captions.captionAccent,
    captions.captionLines,
  ].join("|");
}

export interface SliceSettings {
  layout: LayoutSettings;
  background: BackgroundSettings;
  audio: AudioSettings;
  captions: CaptionSettings;
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
 * The span is where the picture is **in close**, and nothing else. The move in
 * happens in the time before `start` and the move out in the time after `end`,
 * so a two second slice is two seconds at full zoom rather than two seconds
 * with most of a move at each end of it.
 *
 * The span used to include its transitions, on the reasoning that a zoom should
 * not visibly begin outside the thing describing it. What that cost was worse:
 * a slice never showed the level it claimed, and two slices back to back each
 * had to pass through the un-zoomed frame at the boundary — so moving the shot
 * from one part of the screen to another pulled all the way out and pushed all
 * the way back in. `betweenZooms` in `shared/layout.ts` is where the moves are
 * placed now.
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
   * The easing curve, as a cubic bézier's two control points.
   *
   * The same shape CSS `cubic-bezier()` describes, and read the same way: the
   * first point governs how the move leaves rest, the second how it arrives —
   * the entry and the exit of the move. Applied to the move in and the move out
   * alike, so `speed` still says how long each takes and this says what each
   * one feels like.
   *
   * Four flat numbers rather than a nested pair of points, matching every other
   * field here — and each is separately clamped on the way in, which a nested
   * object would have made a special case.
   */
  easeInX: number;
  easeInY: number;
  easeOutX: number;
  easeOutY: number;
  /**
   * Pitch, in degrees. Positive leans the top of the picture away.
   *
   * A perspective tilt rather than a rotation: the far edge is genuinely
   * further away, so it is drawn smaller and the picture converges. That is
   * what makes it read as a camera looking at a screen rather than as a flat
   * image on a slant.
   */
  rotateX: number;
  /** Yaw, in degrees. Positive swings the right edge away. */
  rotateY: number;
  /**
   * How strong the perspective is, 0 to 1, independent of the angle.
   *
   * The angle says which way the picture is turned; this says how much being
   * turned costs it. At 0 the eye is far enough away that a tilt reads as an
   * orthographic lean with the near and far edges near enough the same length;
   * at 1 it is close, and the same angle splays the near edge dramatically.
   *
   * Two controls rather than one because they are genuinely independent — the
   * same 12° looks like a product shot or like a caricature depending only on
   * this — and folding them together was what made the lean impossible to
   * predict from the numbers.
   */
  perspective: number;
  /**
   * Darken the frame towards its edges, 0 to 1.
   *
   * Eased in with the move, like the blur, so a zoom arrives with its vignette
   * rather than wearing one the whole time. Zero by default: it is a look, and
   * one applied to a screen recording without being asked for reads as the
   * export having gone wrong rather than as a choice.
   */
  vignette: number;
  /**
   * Soften everything outside the area being zoomed to.
   *
   * Depth of field, in effect: the shot is looking at one thing, and the rest
   * of the screen is what it is looking past. Off by default — on a screen
   * recording it is a strong effect, and one that hides content someone may
   * have been reading.
   */
  blur: boolean;
  /** How far from the middle stays sharp, as a fraction of the frame. */
  blurSafe: number;
  /** How soft it gets beyond that, as a fraction of the frame's shorter edge. */
  blurStrength: number;
}

export const DEFAULT_ZOOM = {
  target: "cursor",
  x: 0.5,
  y: 0.5,
  level: 2,
  // Long enough to read as a camera move rather than a cut, short enough not to
  // spend the first second of a two-second zoom still arriving.
  speed: 0.6,
  // Exactly the `smoothstep` this replaced, not an approximation of it. With
  // x at a third and two thirds the bézier's own x(t) reduces to t, so y(x)
  // becomes 3x² − 2x³ — the same polynomial, to the last bit. Every project made
  // before the control existed therefore moves precisely as it did.
  easeInX: 1 / 3,
  easeInY: 0,
  easeOutX: 2 / 3,
  easeOutY: 1,
  rotateX: 0,
  rotateY: 0,
  // The eye distance this was fixed at before the control existed, so every
  // project made until now looks exactly as it did.
  perspective: 0.5,
  blur: false,
  blurSafe: 0.28,
  blurStrength: 0.012,
  vignette: 0,
} as const;

/** How long a zoom is when it is first dropped on the timeline. */
export const DEFAULT_ZOOM_LENGTH: Ns = 2_000_000_000;

export interface OutputSettings {
  fps: number;
  format: ExportFormat;
  /**
   * What the frame's *shorter* edge is scaled to, or null to export at the
   * frame's own size.
   *
   * The shorter edge rather than the height, for the same reason every geometry
   * setting is a fraction of it: "720p" has to mean the same amount of detail
   * whether the frame is 16:9 or 9:16, and pinning the height would make a
   * portrait export four times the pixels of a landscape one at the same label.
   */
  shortEdge: number | null;
}

/**
 * The largest shorter edge a GIF is written at.
 *
 * Not a limit of the encoder — it will write any size — but a GIF stores a
 * whole quantised frame each time, with no inter-frame prediction, so a minute
 * of 1080p is gigabytes. Enforced here rather than only in the dialog so a
 * project that arrives with a bigger size cannot start an export nobody would
 * have asked for.
 */
export const GIF_MAX_SHORT_EDGE = 720;

/**
 * The frame an export is actually written at.
 *
 * Scaling here rather than anywhere downstream is what keeps the look intact:
 * `buildRenderPlan` is handed this size and lays the composition out inside it,
 * and every geometry setting is a fraction of the shorter edge — so a 720p
 * export is the same picture as the 1080p one, not a cropped or re-composed
 * version of it. Rescaling the plan's absolute pixels afterwards would be the
 * second implementation of the geometry that `shared/layout.ts` exists to
 * prevent.
 */
export function outputFrame(
  frame: { width: number; height: number },
  shortEdge: number | null,
): { width: number; height: number } {
  const shorter = Math.min(frame.width, frame.height);
  // Never upscaled: asking for 1080p from a 720p frame would spend four times
  // the encode on pixels that carry no more detail.
  if (!shortEdge || shortEdge >= shorter) {
    return { width: evenSize(frame.width), height: evenSize(frame.height) };
  }

  const scale = shortEdge / shorter;
  return {
    width: evenSize(frame.width * scale),
    height: evenSize(frame.height * scale),
  };
}

export interface Project {
  version: number;
  /** The manifest `id` this edits. A project beside a different recording is
      worth catching rather than silently applying. */
  recordingId: string;
  /**
   * What the library calls this recording. Absent means the folder's own name.
   *
   * Kept here rather than in the directory name so a rename never moves the
   * folder: `prequel-media://` URLs are built from its basename, `manifest.id`
   * repeats it, and the transcript is discarded when the two disagree. Renaming
   * on disk would invalidate all three to change a label.
   */
  name?: string;
  frame: { width: number; height: number; presetId: string | null };
  /** Every slice inherits from these. */
  defaults: SliceSettings;
  tracks: ProjectTrack[];
  /** Zoom spans, in source time. Sorted, and never overlapping. */
  zooms: ZoomSlice[];
  /** Blur spans, in source time. Sorted. */
  blurs: BlurSlice[];
  output: OutputSettings;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_LAYOUT: LayoutSettings = {
  preset: "over-padded",
  // The whole frame, which is what `custom` opens on if it is ever reached
  // from a preset that had the screen full-bleed. Only ever read there.
  screenX: 0.5,
  screenY: 0.5,
  screenWidth: 1,
  screenHeight: 1,
  screenOffsetX: 0,
  screenOffsetY: 0,
  cameraVisible: true,
  cameraShape: "squircle",
  cameraWidth: 0.35,
  cameraHeight: 0.35,
  // The default arrangement floats the camera over the screen.
  cameraCard: false,
  cameraZoom: 1,
  // Bottom right, standing off both edges by about a sixteenth of the frame.
  //
  // The pointer spends most of a demonstration on the left and in the middle —
  // menus, sidebars, the thing being clicked — so the far corner is the one
  // least often in the way of the point being made.
  //
  // Read against `cameraHeight`, not on their own: the position is the bubble's
  // *centre*, so the margin is whatever is left after half a bubble. At 0.85
  // and this size the centre was past the point where a whole bubble still
  // fits, `cameraRect` clamped it, and it sat flush on the bottom edge with a
  // shadow it had nowhere to cast. Changing one of the three without the
  // others puts it back against the edge.
  cameraX: 0.87,
  cameraY: 0.77,
  cameraOffsetX: 0,
  cameraOffsetY: 0,
  cameraShrinkOnZoom: true,
  // Small enough to give the picture back a visible amount of room, large
  // enough that whoever is on camera is still legible rather than a thumbnail.
  cameraShrinkTo: 0.7,
  cameraMirror: true,
  cursorVisible: true,
  // About the size the pointer appears on screen in a 1080p frame, so an export
  // looks like the recording rather than like a diagram of it.
  cursorSize: 0.035,
  // Enough to take the 30 Hz corners out of an ordinary move without the
  // pointer visibly trailing the hand that made it.
  cursorSmoothing: 0.4,
  // Enough to soften a fast flick without the pointer smearing while it is
  // being read. Deliberately below half a shutter: the pointer is the one thing
  // on screen a viewer is actively following, and a streak long enough to
  // notice is a streak long enough to lose it in.
  cursorMotionBlur: 0.4,
  // Only what a *new* project starts with. An existing `project.json` names its
  // own style and keeps it, so nobody's edit changes shape underneath them.
  cursorStyle: "modern-black",
  cursorAutoHide: false,
  cursorHideAfter: 2,
  cursorHideWhileTyping: true,
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
  // A shipped picture rather than the user's own desktop.
  //
  // The desktop was the better idea — a recording sitting on the wallpaper it
  // was taken against reads as one image rather than a screenshot pasted onto
  // something — but capturing it is not reliable enough to open on. It depends
  // on finding the desktop behind every window, and when that fails the first
  // thing anyone sees is a blank frame. This is still there under `My
  // wallpaper` for anyone who wants it.
  background: { kind: "image", source: "preset", path: "monterey.jpg" },
  padding: 0.06,
  cornerRadius: 0.02,
  // A hairline of white at low opacity, which is what a border is for here: it
  // lifts the picture off a dark wallpaper by catching its edge, rather than
  // drawing a frame round it. A solid one at full opacity reads as a border
  // *added to* the recording and is the first thing anybody turns back off.
  //
  // It needs somewhere to go — the border sits outside the picture, so at zero
  // padding it falls off the edge and a default that draws nothing would be
  // worse than no default at all. `padding` above is what makes room for it.
  borderWidth: 0.009,
  borderColor: "#ffffff",
  borderOpacity: 0.131,
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

export const DEFAULT_CAPTIONS: CaptionSettings = {
  // On. A recording with a microphone transcribes itself when it is opened, so
  // by the time anyone looks there are captions to show — and a switch that is
  // off by default on a feature that ran anyway is friction for nothing.
  //
  // Only new projects. One saved before this keeps whatever it had, which is
  captionsOn: true,
  captionStyle: "highlight",
  captionSize: 0.04,
  captionPlace: "bottom",
  captionOffset: 0.08,
  captionAccent: "#ffd60a",
  captionLines: 1,
};

export const DEFAULT_SETTINGS: SliceSettings = {
  layout: DEFAULT_LAYOUT,
  background: DEFAULT_BACKGROUND,
  audio: DEFAULT_AUDIO,
  captions: DEFAULT_CAPTIONS,
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
      // Both to the unit square. x because a bézier whose control points run
      // backwards is not a timing function — it doubles back, and a zoom that
      // briefly un-zooms mid-move is not something the control should be able to
      // ask for.
      //
      // y for two reasons that agree. A value past the ends is overshoot, which
      // would take the picture beyond the level the zoom says it reaches; and it
      // would put the handle outside the pad that sets it, so the control could
      // be dragged into a state it cannot then show. Anticipation and bounce are
      // a real look, but they need a taller pad and a level that means "peak"
      // rather than "arrival" — a bigger change than this one.
      easeInX: clamp(number(zoom?.["easeInX"], DEFAULT_ZOOM.easeInX), 0, 1),
      easeInY: clamp(number(zoom?.["easeInY"], DEFAULT_ZOOM.easeInY), 0, 1),
      easeOutX: clamp(number(zoom?.["easeOutX"], DEFAULT_ZOOM.easeOutX), 0, 1),
      easeOutY: clamp(number(zoom?.["easeOutY"], DEFAULT_ZOOM.easeOutY), 0, 1),
      // Past about thirty degrees the far edge is short enough that the
      // picture is more foreshortening than content.
      //
      // `tilt`, `yaw` and `depth` are what these three were called until they
      // were renamed for the axes they actually turn about. Read as a fallback
      // rather than migrated in place: a project is rewritten only when
      // something in it is edited, so a rename with no fallback would leave
      // every recording made before it silently flat — the values are still
      // there in the file, and nothing would be reading them.
      rotateX: clamp(number(zoom?.["rotateX"] ?? zoom?.["tilt"], DEFAULT_ZOOM.rotateX), -30, 30),
      rotateY: clamp(number(zoom?.["rotateY"] ?? zoom?.["yaw"], DEFAULT_ZOOM.rotateY), -30, 30),
      // Absent in every project written before this existed, which is what the
      // default is for: they read back at the distance they were drawn at.
      perspective: clamp(
        number(zoom?.["perspective"] ?? zoom?.["depth"], DEFAULT_ZOOM.perspective),
        0,
        1,
      ),
      // Absent in every project written before this existed, and the default is
      // no vignette — so those all read back looking exactly as they did.
      vignette: clamp(number(zoom?.["vignette"], DEFAULT_ZOOM.vignette), 0, 1),
      blur: zoom?.["blur"] === true,
      blurSafe: clamp(number(zoom?.["blurSafe"], DEFAULT_ZOOM.blurSafe), 0.05, 0.9),
      blurStrength: clamp(number(zoom?.["blurStrength"], DEFAULT_ZOOM.blurStrength), 0, 0.04),
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
 *
 * `fullScreen` opens a whole-screen recording without the card treatment. A
 * window or a region is an object with edges, and inset on a background it
 * reads as one; a whole screen already fills the frame it was recorded in, and
 * insetting it only shrinks the thing being demonstrated and puts a border of
 * desktop picture around a picture of a desktop. The corner radius goes with
 * the padding rather than staying behind — kept on a full-bleed picture it cuts
 * four notches out of the corners with the background showing through, which
 * looks like a bug rather than like a choice.
 */
export function newProject(recordingId: string, duration: Ns, fullScreen = false): Project {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  if (fullScreen) {
    defaults.layout.preset = "over-full";
    defaults.background.padding = 0;
    defaults.background.cornerRadius = 0;
  }

  return {
    version: PROJECT_VERSION,
    recordingId,
    frame: { width: 1920, height: 1080, presetId: DEFAULT_PRESET_ID },
    defaults,
    zooms: [],
    blurs: [],
    tracks: [
      {
        id: "composite",
        kind: "composite",
        slices: [{ id: "take", source: { start: 0, end: duration }, overrides: {} }],
      },
    ],
    output: { fps: 60, format: "h264", shortEdge: null },
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
    captions: { ...defaults.captions, ...overrides?.captions },
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
      overrides: migrateOverrides((slice.overrides ?? {}) as SliceOverrides),
    }))
    // A slice that survived clamping as empty cannot be drawn or rendered.
    .filter((slice) => slice.source.end > slice.source.start);

  return {
    version: PROJECT_VERSION,
    recordingId,
    // Optional, and left off entirely when it is not a usable string — a
    // project that never had one must keep reporting the folder's name rather
    // than an empty label.
    ...(typeof stored.name === "string" && stored.name.trim() !== ""
      ? { name: stored.name.trim() }
      : {}),
    frame: { width, height, presetId: stored.frame?.presetId ?? null },
    defaults: {
      layout: {
        ...DEFAULT_LAYOUT,
        ...beforeShrinking(stored.defaults?.layout),
        ...beforeSmoothing(stored.defaults?.layout),
        ...beforeMotionBlur(stored.defaults?.layout),
        ...migrateLayout(stored.defaults?.layout),
      },
      background: { ...DEFAULT_BACKGROUND, ...stored.defaults?.background },
      audio: { ...DEFAULT_AUDIO, ...stored.defaults?.audio },
      captions: { ...DEFAULT_CAPTIONS, ...stored.defaults?.captions },
    },
    zooms: sanitiseZooms(stored.zooms, duration),
    blurs: extractLegacyBlurs(stored, slices, duration),
    tracks: [
      {
        id: "composite",
        kind: "composite",
        // Everything cut away is recoverable by adding slices back; a project
        // with none at all is not something the editor can show.
        slices: slices.length > 0 ? slices : fresh.tracks[0]!.slices,
      },
    ],
    output: outputSettings(stored.output),
  };
}

/**
 * Switches the camera's shrink off for a project written before it existed.
 *
 * New projects start with it on — it is the better default and the reason it
 * was added. But `sanitiseProject` spreads what is on disk over
 * `DEFAULT_LAYOUT`, so a key nobody ever wrote takes that default, and every
 * recording already edited would come back with its bubble moving in a way its
 * author never asked for. The rule `perspective` and `vignette` were defaulted
 * by holds here too: a new field must read back the way the project looked when
 * it was saved.
 *
 * Deliberately *not* part of `migrateLayout`, which is also run over a slice's
 * overrides — writing the key there would make `key in overrides.layout` answer
 * yes for every slice, and the panel would show a shrink overridden on clips
 * that override nothing.
 */
function beforeShrinking(
  stored: Partial<LayoutSettings> | undefined,
): Partial<LayoutSettings> | undefined {
  if (!stored || "cameraShrinkOnZoom" in stored) return undefined;
  return { cameraShrinkOnZoom: false };
}

/**
 * Leaves the pointer unsmoothed in a project written before smoothing existed.
 *
 * `beforeShrinking`'s rule, for the same reason: a new default that changes how
 * an edit already on disk plays back is a project that came back different from
 * the one its author saved. New recordings get the smoothing; an old one is one
 * slider away from it.
 */
function beforeSmoothing(
  stored: Partial<LayoutSettings> | undefined,
): Partial<LayoutSettings> | undefined {
  if (!stored || "cursorSmoothing" in stored) return undefined;
  return { cursorSmoothing: 0 };
}

/**
 * Leaves the pointer sharp in a project written before motion blur existed.
 *
 * `beforeSmoothing`'s rule, and for the third time the same reason: a new
 * default that changes how an edit already on disk plays back is a project that
 * came back different from the one its author saved. New recordings get the
 * blur; an old one is one slider away from it.
 */
function beforeMotionBlur(
  stored: Partial<LayoutSettings> | undefined,
): Partial<LayoutSettings> | undefined {
  if (!stored || "cursorMotionBlur" in stored) return undefined;
  return { cursorMotionBlur: 0 };
}

/**
 * Reads a layout block written before the composition became an arrangement.
 *
 * The version is deliberately *not* bumped for this: `sanitiseProject` treats a
 * mismatch as unusable and starts fresh, so a bump would throw away every
 * project on disk to rename two keys. The old names are read here instead and
 * translated, and the new ones win wherever both are present.
 *
 * Returns a partial, because it is spread over `DEFAULT_LAYOUT` — a key nobody
 * ever wrote must fall through to its default rather than arrive as undefined.
 *
 * It is also where a key that has been *removed* is stripped, for the same
 * reason and without a version bump.
 */
function migrateLayout(
  stored: Partial<LayoutSettings> | undefined,
): Partial<LayoutSettings> | undefined {
  if (!stored) return stored;

  const legacy = stored as Partial<LayoutSettings> & {
    screenFit?: unknown;
    cameraSize?: unknown;
  };
  const migrated: Partial<LayoutSettings> = { ...stored };
  delete (migrated as { screenFit?: unknown }).screenFit;
  delete (migrated as { cameraSize?: unknown }).cameraSize;
  // The screen's own zoom, removed once the zoom moments made it a second
  // answer to the same question. Dropped rather than left to sit unread: a
  // slice that overrode it would otherwise keep `key in overrides.layout`
  // answering yes for a setting no control can reach, and the Screen section
  // would offer a Reset for something invisible.
  delete (migrated as { screenZoom?: unknown }).screenZoom;

  // Arrangements that have been taken out of the grid. Translated rather than
  // left to sit on disk: `layoutBoxes` answers for the arrangements that exist,
  // and a project naming one that does not gets no boxes at all — a recording
  // that opens showing nothing, which reads as lost footage rather than as a
  // removed preset. Each lands on the survivor it differed from least.
  const removed: Record<string, LayoutPreset> = {
    "beside-flush": "beside",
    "split-stacked": "stacked",
  };
  const replacement = removed[legacy.preset as string];
  if (replacement !== undefined) migrated.preset = replacement;

  if (migrated.preset === undefined && legacy.screenFit !== undefined) {
    const full = legacy.screenFit === "cover";
    // A hidden camera becomes the screen-only arrangement rather than an
    // `over-*` one with the bubble switched off. Both draw the same picture,
    // but only one of them lights the cell in the picker that matches it.
    migrated.preset =
      legacy.cameraVisible === false
        ? full
          ? "screen-full"
          : "screen-padded"
        : full
          ? "over-full"
          : "over-padded";
  }

  // `cameraSize` was the bubble's height whatever its shape, and the width came
  // from the shape. The width is stored now, so it has to be worked out once,
  // here. The camera's real proportions are not known when a file is read off
  // disk — 16:9 is what all but a handful of webcams record, and being wrong
  // costs a `wide` bubble a few per cent of its width.
  if (typeof legacy.cameraSize === "number") {
    const height = legacy.cameraSize;
    if (migrated.cameraHeight === undefined) migrated.cameraHeight = height;
    if (migrated.cameraWidth === undefined) {
      migrated.cameraWidth = legacy.cameraShape === "wide" ? (height * 16) / 9 : height;
    }
  }

  return migrated;
}

/**
 * Extracts blurs from the old slice-based format and turns them into timeline items.
 */
function extractLegacyBlurs(
  stored: Partial<Project>,
  slices: { source: { start: number; end: number }; overrides: SliceOverrides }[],
  duration: Ns,
): BlurSlice[] {
  const blurs: BlurSlice[] = [];

  if (stored.blurs && Array.isArray(stored.blurs)) {
    // Already migrated, just sanitise
    return (stored.blurs as unknown as Record<string, unknown>[])
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
      .map((r, index) => ({
        id: typeof r["id"] === "string" ? (r["id"] as string) : `blur-${index}`,
        source: {
          start: clamp(number((r["source"] as never)?.["start"], 0), 0, duration),
          end: clamp(number((r["source"] as never)?.["end"], duration), 0, duration),
        },
        x: clamp(number(r["x"], 0.5), 0, 1),
        y: clamp(number(r["y"], 0.5), 0, 1),
        width: clamp(number(r["width"], 0.1), 0.01, 1),
        height: clamp(number(r["height"], 0.1), 0.01, 1),
        strength: clamp(number(r["strength"], 0.015), 0, 0.1),
        keyframes: (r["keyframes"] as BlurKeyframe[]) ?? [],
      }))
      .filter((b) => b.source.end > b.source.start)
      .sort((a, b) => a.source.start - b.source.start);
  }

  // Migrate from slice overrides
  for (const slice of slices) {
    const rawBlur = (slice.overrides as any)?.blur;
    if (rawBlur && Array.isArray(rawBlur.regions)) {
      const regions = rawBlur.regions as Record<string, unknown>[];
      for (const [index, r] of regions.entries()) {
        if (!r || typeof r !== "object") continue;
        blurs.push({
          id: typeof r["id"] === "string" ? (r["id"] as string) : `blur-migrated-${index}`,
          source: { start: slice.source.start, end: slice.source.end },
          x: clamp(number(r["x"], 0.5), 0, 1),
          y: clamp(number(r["y"], 0.5), 0, 1),
          width: clamp(number(r["width"], 0.1), 0.01, 1),
          height: clamp(number(r["height"], 0.1), 0.01, 1),
          strength: clamp(number(r["strength"], 0.015), 0, 0.1),
          keyframes: (r["keyframes"] as BlurKeyframe[]) ?? [],
        });
      }
    }
  }

  return blurs.sort((a, b) => a.source.start - b.source.start);
}

/** The same translation, for the keys a slice set for itself. */
function migrateOverrides(overrides: SliceOverrides): SliceOverrides {
  if (!overrides.layout) return overrides;

  const layout = migrateLayout(overrides.layout);
  // An empty block would make `key in overrides.layout` answer "yes, something"
  // for a slice that overrides nothing, which is the one thing the flat-leaf
  // rule exists to keep true.
  if (!layout || Object.keys(layout).length === 0) {
    const { layout: _dropped, ...rest } = overrides;
    return rest;
  }

  return { ...overrides, layout };
}

/** Repairs the output block, keeping the format and its limits consistent. */
function outputSettings(stored: Partial<OutputSettings> | undefined): OutputSettings {
  // `codec` is what `format` was called before GIF joined it. Read as a
  // fallback so a project written by an older build keeps its HEVC choice
  // rather than quietly reverting to H.264.
  const format = exportFormat(stored?.format ?? (stored as { codec?: unknown } | undefined)?.codec);

  const shortEdge =
    typeof stored?.shortEdge === "number" ? clamp(Math.round(stored.shortEdge), 64, 4320) : null;

  return {
    fps: clamp(number(stored?.fps, 60), 1, 120),
    format,
    shortEdge:
      format === "gif" ? Math.min(shortEdge ?? GIF_MAX_SHORT_EDGE, GIF_MAX_SHORT_EDGE) : shortEdge,
  };
}

/** Narrows a stored string to a format, defaulting to the one everything plays. */
function exportFormat(value: unknown): ExportFormat {
  return value === "hevc" || value === "gif" ? value : "h264";
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
