/**
 * A saved look, and the list of them the app offers.
 *
 * Not `presets.ts`, which is next door and is about output sizes and swatch
 * palettes — `FRAME_PRESETS`, `SOLID_PRESETS`, `LayoutPreset`. This is the other
 * thing the word means: everything about how a scene is dressed, saved once and
 * applied to another recording in a click.
 *
 * Two kinds, one type. Which list a preset arrived in is what makes it ours or
 * the user's, not a field on it — two nearly identical shapes is the thing that
 * goes out of sync, and every consumer here treats them identically.
 *
 * What it deliberately does not carry:
 *
 * - **`audio`.** A preset that muted a microphone would silence a recording,
 *   and the card cannot show sound. How loud a take was is a fact about the
 *   take.
 * - **`captionsOn`.** Whether to caption at all is a fact about the recording
 *   too — switched on for a take with no voice it enables a panel whose every
 *   control is dead.
 * - **Where a zoom goes.** `ZoomDefaults` is how a zoom *moves*; `target`, `x`
 *   and `y` are about one shot on one recording.
 *
 * Deliberately free of any `electron`, Node or DOM import: main stores them,
 * the renderer draws them, and the reducer applies them.
 */
import { captionStyle } from "./captions.js";
import { cursorStyle } from "./contract.js";
import { layoutBoxes } from "./layout.js";
import { AUTO_PRESET_ID, evenSize, findPreset } from "./presets.js";
import {
  DEFAULT_BACKGROUND,
  DEFAULT_CAPTIONS,
  DEFAULT_LAYOUT,
  DEFAULT_WATERMARK,
  DEFAULT_ZOOM,
  sanitiseZoomLook,
  type Background,
  type BackgroundSettings,
  type CaptionSettings,
  type LayoutSettings,
  type WatermarkSettings,
  type ZoomDefaults,
} from "./project.js";

/**
 * Bumped when the shape changes in a way an older app cannot read.
 *
 * Checked rather than trusted, and a catalogue it does not understand is
 * ignored rather than thrown on — an app that will not open its editor because
 * we published a new field is a much worse outcome than one with a short list.
 */
export const SCENE_PRESETS_VERSION = 1;

/** What a preset's own picture is called inside its folder. */
export const PRESET_BACKGROUND_FILE = "background.png";

/**
 * The alphabet an id may use.
 *
 * The media protocol serves a preset's card by its id, so an id *is* a file
 * name — which is why ids are generated and never derived from the name the
 * user typed. The same reasoning behind `pictureKey` in the backgrounds route.
 */
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** The captions a preset carries: the look, never whether there is one. */
export type PresetCaptions = Omit<CaptionSettings, "captionsOn">;

export interface ScenePreset {
  id: string;
  name: string;
  /** Newest first is the whole ordering, which is why there is no `order`. */
  savedAt: number;
  /**
   * The frame this look was made in, and the one applying it sets.
   *
   * Never `AUTO_PRESET_ID`. Automatic is not a size — it is the absence of
   * choosing one, and `useAutoFrame` writes the recording's own size back over
   * it on the next tick. A preset carrying it would have its frame silently
   * discarded, and worse, undo would appear not to work: the frame comes back
   * and the effect clobbers it again a frame later.
   */
  frame: { width: number; height: number; presetId: string | null };
  layout: LayoutSettings;
  background: BackgroundSettings;
  captions: PresetCaptions;
  /**
   * The logo, if the look carries one.
   *
   * Its file travels with the preset under its *own* name rather than a
   * renamed copy, because `pickWatermarkImage` names it after its own bytes —
   * so the same logo saved from two recordings is one file, and two different
   * logos can never collide. The background predates that and is still
   * normalised; see `presetBackground`.
   */
  watermark: WatermarkSettings;
  zoom: ZoomDefaults;
}

/** The list as it is stored on disk. */
export interface ScenePresetsFile {
  version: number;
  presets: ScenePreset[];
}

/**
 * Repairs one preset, or refuses it.
 *
 * Null rather than a throw, and per preset rather than per list: one bad entry
 * in a published catalogue must cost that entry, not the whole picker.
 *
 * Every section is spread over `project.ts`'s own defaults, exactly as
 * `sanitiseProject` does it, so a setting added there has one place to be
 * handled rather than two. This is also where a preset from a **newer** build
 * is made safe — a `cursorStyle` or `captionStyle` this app does not have falls
 * back to one it does. `apps/api` may not import this file, so a publish-time
 * check could never have covered that direction anyway.
 */
export function sanitiseScenePreset(value: unknown): ScenePreset | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Partial<ScenePreset>;

  if (typeof stored.id !== "string" || !ID.test(stored.id)) return null;
  const name = typeof stored.name === "string" ? stored.name.trim() : "";
  if (name === "") return null;

  const width = evenSize(number(stored.frame?.width, 1920));
  const height = evenSize(number(stored.frame?.height, 1080));

  const layout: LayoutSettings = {
    ...DEFAULT_LAYOUT,
    ...stored.layout,
    // Normalised to a style this build has, rather than left to fall back at
    // draw time. `cursorStyle()` already answers with a real style either way —
    // what this stops is the unknown id being written into a slice's overrides,
    // where it would sit unreadable and outlive the preset it came from.
    cursorStyle: cursorStyle(String(stored.layout?.cursorStyle ?? DEFAULT_LAYOUT.cursorStyle)).id,
  };

  const captions: PresetCaptions = {
    ...dropCaptionsOn(DEFAULT_CAPTIONS),
    ...storedCaptionLook(stored.captions),
    // Normalised for the reason `cursorStyle` is, just above.
    captionStyle: captionStyle(
      String(stored.captions?.captionStyle ?? DEFAULT_CAPTIONS.captionStyle),
    ).id,
  };

  return {
    id: stored.id,
    name,
    savedAt: number(stored.savedAt, 0),
    frame: {
      width,
      height,
      // `auto` is refused rather than repaired: it is not a size, so there is
      // nothing to keep. The preset gets whichever named size matches its
      // dimensions, or none.
      presetId:
        typeof stored.frame?.presetId === "string" && stored.frame.presetId !== AUTO_PRESET_ID
          ? (findPreset(stored.frame.presetId)?.id ?? null)
          : null,
    },
    layout,
    background: {
      ...DEFAULT_BACKGROUND,
      ...stored.background,
      background: presetBackground(stored.background?.background),
    },
    captions,
    watermark: presetWatermark(stored.watermark),
    zoom: sanitiseZoomLook(stored.zoom, DEFAULT_ZOOM),
  };
}

/** The list, with anything unreadable dropped rather than the lot. */
export function sanitiseScenePresets(value: unknown): ScenePreset[] {
  const stored = value as Partial<ScenePresetsFile> | null;
  if (!stored || stored.version !== SCENE_PRESETS_VERSION) return [];
  if (!Array.isArray(stored.presets)) return [];

  return stored.presets
    .map(sanitiseScenePreset)
    .filter((preset): preset is ScenePreset => preset !== null)
    .sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * A background a preset may carry, with the three sources meaning three things.
 *
 * - `preset` names a file in the hosted background catalogue, so applying it is
 *   `ensureBackground` and nothing new. This is what the ones we publish use.
 * - `file` means **the preset's own picture**, always, and always under
 *   `PRESET_BACKGROUND_FILE`. The path is forced rather than trusted: a saved
 *   preset would otherwise hold `background-custom.png`, which is a fixed name
 *   inside whichever recording it was saved from — applied elsewhere that
 *   either names nothing, or names a *different* picture that happens to be
 *   sitting under the same name. The second is the bad one: it applies cleanly,
 *   shows the wrong photograph, and the card still shows the right one.
 * - `wallpaper` is left alone deliberately. Every recording has a
 *   `background.png` and they are all different desktops, so carrying it means
 *   "whatever this recording was taken against" — which is what picking *My
 *   wallpaper* asks for.
 */
function presetBackground(stored: Background | undefined): Background {
  if (!stored || typeof stored !== "object") return DEFAULT_BACKGROUND.background;

  switch (stored.kind) {
    case "solid":
      return typeof stored.color === "string"
        ? { kind: "solid", color: stored.color }
        : DEFAULT_BACKGROUND.background;
    case "gradient":
      return {
        kind: "gradient",
        from: String(stored.from),
        to: String(stored.to),
        angle: number(stored.angle, 135),
      };
    case "image":
      if (stored.source === "wallpaper") return { kind: "image", source: "wallpaper", path: "" };
      if (stored.source === "file") {
        return { kind: "image", source: "file", path: PRESET_BACKGROUND_FILE };
      }
      return typeof stored.path === "string" && stored.path !== ""
        ? { kind: "image", source: "preset", path: stored.path }
        : DEFAULT_BACKGROUND.background;
    default:
      return DEFAULT_BACKGROUND.background;
  }
}

/**
 * Which of the two pictures a look actually shows.
 *
 * Asked of `layoutBoxes` rather than worked out from `layout.preset` here.
 * That function is deliberately the only thing that reads the arrangement — a
 * second reader is how a card comes to promise a camera the composition does
 * not draw — and it already answers this exactly: a slot is null when the
 * arrangement has no room for that picture, or when the camera toggle is off.
 *
 * Both sources are handed in as present, because the question is what the
 * *look* shows and not what this recording happens to have. A preset built
 * around a camera is still a preset built around a camera when it is listed
 * beside a screen-only take. Their sizes only reach geometry, which is thrown
 * away here.
 */
export function picturesIn(preset: ScenePreset): { screen: boolean; camera: boolean } {
  const boxes = layoutBoxes(preset.frame, preset.layout, preset.background, {
    screen: ANY_SOURCE,
    camera: ANY_SOURCE,
  });

  return { screen: boxes.screen !== null, camera: boxes.camera !== null };
}

/** A stand-in size. Only its presence is read; the geometry is discarded. */
const ANY_SOURCE = { width: 1920, height: 1080 };

/**
 * The logo a look carries, with a name that means something anywhere.
 *
 * Only a `watermark-<hash>.png` survives. Anything else — a name from a build
 * that chose differently, or a path — is dropped along with the mark, because a
 * preset naming a file that is not there draws nothing and says nothing about
 * why. The picture itself is copied into the preset's folder on save.
 */
function presetWatermark(stored: WatermarkSettings | undefined): WatermarkSettings {
  const merged = { ...DEFAULT_WATERMARK, ...stored };
  const file = merged.watermark;

  return {
    ...merged,
    watermark: typeof file === "string" && CARRIED.test(file) ? file : null,
  };
}

/** The shape `pickWatermarkImage` writes, and the only one a preset may carry. */
const CARRIED = /^watermark-[a-z0-9]+\.png$/i;

/** The logo a preset brings with it, or null when it brings none. */
export function presetWatermarkFile(preset: ScenePreset): string | null {
  return preset.watermark.watermark;
}

/** Whether applying this preset has to fetch a picture first. */
export function presetNeedsBackground(preset: ScenePreset): string | null {
  const { background } = preset.background;
  return background.kind === "image" && background.source === "preset" ? background.path : null;
}

/** Whether the preset brings a picture of its own to copy in. */
export function presetCarriesImage(preset: ScenePreset): boolean {
  const { background } = preset.background;
  return background.kind === "image" && background.source === "file";
}

/** The look half of a full settings block. */
function dropCaptionsOn(captions: CaptionSettings): PresetCaptions {
  const { captionsOn: _dropped, ...look } = captions;
  return look;
}

/**
 * The same, off something read from disk.
 *
 * Stripped at *runtime* as well as in the type: `captionsOn` sitting in a stored
 * preset would otherwise spread straight through, and a preset that switched
 * captions on for a recording with no voice would enable a panel whose every
 * control is dead.
 */
function storedCaptionLook(stored: unknown): Partial<PresetCaptions> {
  if (typeof stored !== "object" || stored === null) return {};
  const { captionsOn: _dropped, ...look } = stored as CaptionSettings;
  return look;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
