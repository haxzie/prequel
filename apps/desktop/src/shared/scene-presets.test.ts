/**
 * What a saved look is allowed to carry between recordings.
 *
 * Most of these are about the things a preset must *not* take with it. A look
 * that carries too much fails quietly — it applies cleanly, and what is wrong is
 * a picture, a muted microphone or a caption panel that should not be there.
 */
import { describe, expect, it } from "vitest";

import { CAPTION_STYLES } from "./captions";
import { CURSOR_STYLES } from "./contract";
import { AUTO_PRESET_ID } from "./presets";
import {
  DEFAULT_BACKGROUND,
  DEFAULT_CAPTIONS,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  DEFAULT_WATERMARK,
  DEFAULT_ZOOM_LOOK,
} from "./project";
import {
  PRESET_BACKGROUND_FILE,
  SCENE_PRESETS_VERSION,
  sanitiseScenePreset,
  sanitiseScenePresets,
  type ScenePreset,
} from "./scene-presets";

function stored(over: Record<string, unknown> = {}): Record<string, unknown> {
  const { captionsOn: _dropped, ...captions } = DEFAULT_CAPTIONS;

  return {
    id: "kinetic",
    name: "Kinetic",
    savedAt: 1,
    frame: { width: 1920, height: 1080, presetId: "16:9" },
    layout: { ...DEFAULT_LAYOUT },
    background: { ...DEFAULT_BACKGROUND },
    captions,
    watermark: { ...DEFAULT_WATERMARK },
    zoom: { ...DEFAULT_ZOOM_LOOK },
    ...over,
  };
}

function read(over: Record<string, unknown> = {}): ScenePreset {
  return sanitiseScenePreset(stored(over))!;
}

describe("what a look carries", () => {
  it("carries every setting a look is made of", () => {
    // The failure this catches is a setting added to `project.ts` and not here:
    // it simply does not travel, and the preset looks *nearly* right on the next
    // recording — which is much harder to notice than one that looks wrong.
    const preset = read();

    expect(Object.keys(preset.layout).sort()).toEqual(Object.keys(DEFAULT_LAYOUT).sort());
    expect(Object.keys(preset.background).sort()).toEqual(Object.keys(DEFAULT_BACKGROUND).sort());
    expect(Object.keys(preset.watermark).sort()).toEqual(Object.keys(DEFAULT_WATERMARK).sort());
    expect(Object.keys(preset.zoom).sort()).toEqual(Object.keys(DEFAULT_ZOOM_LOOK).sort());
  });

  it("carries every section a look is made of, and no others", () => {
    // The check above catches a *setting* added to a section and forgotten
    // here. This one catches a whole **section** added to `SliceSettings` and
    // forgotten — a panel's worth of look that silently does not travel, which
    // is the same failure one size larger.
    //
    // `audio` is the deliberate absence: a preset that muted a microphone would
    // silence a recording, and a still card cannot show sound.
    const preset = read();
    const sections = Object.keys(DEFAULT_SETTINGS).filter((section) => section in preset);

    expect(sections.sort()).toEqual(["background", "captions", "layout", "watermark"]);
    expect("audio" in preset).toBe(false);
  });

  it("carries how far the background is thrown out of focus", () => {
    // A `background` leaf, so it travels with the rest of the section — but it
    // is the reason the blur was added, so it is worth pinning by value rather
    // than trusting the key-set check above.
    const preset = read({ background: { ...DEFAULT_BACKGROUND, backgroundBlur: 0.03 } });
    expect(preset.background.backgroundBlur).toBeCloseTo(0.03);
  });

  it("carries every caption setting except whether there are captions", () => {
    const preset = read();
    const look = Object.keys(DEFAULT_CAPTIONS).filter((key) => key !== "captionsOn");

    expect(Object.keys(preset.captions).sort()).toEqual(look.sort());
  });

  it("never carries whether captions are on, however it is asked", () => {
    // Whether to caption is a fact about the recording. Stripped at runtime as
    // well as in the type, because a stored preset is JSON and the type is not
    // there to stop it.
    const preset = read({ captions: { ...DEFAULT_CAPTIONS, captionsOn: true } });
    expect("captionsOn" in preset.captions).toBe(false);
  });

  it("never carries audio", () => {
    // A preset that muted a microphone would silence a recording, and the card
    // cannot show sound.
    const preset = read({ audio: { micVolume: 0, micMuted: true } });
    expect("audio" in preset).toBe(false);
  });

  it("never carries the automatic frame", () => {
    // `auto` is not a size, it is the absence of choosing one — and `useAutoFrame`
    // writes the recording's own size straight back over it. A preset holding it
    // has its frame silently discarded, and undo appears not to work: the frame
    // comes back and the effect clobbers it a tick later.
    const preset = read({ frame: { width: 1920, height: 1080, presetId: AUTO_PRESET_ID } });

    expect(preset.frame.presetId).not.toBe(AUTO_PRESET_ID);
    expect(preset.frame.width).toBe(1920);
  });
});

describe("a look's background", () => {
  it("refuses to carry a picture that lives inside one recording", () => {
    // `background-custom.png` is a fixed name inside whichever recording it was
    // chosen in. Carried as it stands, applying the preset elsewhere either
    // names nothing — a dark composition — or names a *different* photograph
    // that happens to sit under the same name, which applies cleanly, looks
    // wrong, and leaves the card still showing the right one.
    const preset = read({
      background: {
        ...DEFAULT_BACKGROUND,
        background: { kind: "image", source: "file", path: "background-custom.png" },
      },
    });

    expect(preset.background.background).toEqual({
      kind: "image",
      source: "file",
      path: PRESET_BACKGROUND_FILE,
    });
  });

  it("keeps a catalogue picture by name, so it can be fetched anywhere", () => {
    const preset = read({
      background: {
        ...DEFAULT_BACKGROUND,
        background: { kind: "image", source: "preset", path: "indigo.jpg" },
      },
    });

    expect(preset.background.background).toEqual({
      kind: "image",
      source: "preset",
      path: "indigo.jpg",
    });
  });

  it("keeps `my wallpaper` meaning this recording's own desktop", () => {
    // Deliberate: every recording has one and they are all different, so
    // carrying it means "whatever this was taken against" — which is what
    // picking it asked for.
    const preset = read({
      background: {
        ...DEFAULT_BACKGROUND,
        background: { kind: "image", source: "wallpaper", path: "background.png" },
      },
    });

    expect(preset.background.background.kind).toBe("image");
    expect((preset.background.background as { source: string }).source).toBe("wallpaper");
  });
});

describe("reading one written by another build", () => {
  it("falls back to a pointer this build has", () => {
    // `cursorStyle()` would fall back at draw time anyway. What this stops is
    // the unknown id being written into a clip's overrides, where it outlives
    // the preset and no control can reach it.
    const preset = read({ layout: { ...DEFAULT_LAYOUT, cursorStyle: "not-in-this-build" } });
    expect(CURSOR_STYLES.some((style) => style.id === preset.layout.cursorStyle)).toBe(true);
  });

  it("falls back to a caption look this build has", () => {
    const preset = read({ captions: { captionStyle: "not-in-this-build" } });
    expect(CAPTION_STYLES.some((style) => style.id === preset.captions.captionStyle)).toBe(true);
  });

  it("fills in a setting it has never heard of, rather than failing", () => {
    const preset = sanitiseScenePreset({ ...stored(), layout: { cameraShape: "circle" } })!;

    expect(preset.layout.cameraShape).toBe("circle");
    expect(preset.layout.cameraX).toBe(DEFAULT_LAYOUT.cameraX);
  });

  it("clamps a zoom feel to what a control could have produced", () => {
    // The same table `sanitiseZooms` uses, which is why it is one function: two
    // clamp tables is how a preset comes to hold a level no slider can reach.
    const preset = read({ zoom: { ...DEFAULT_ZOOM_LOOK, level: 99, rotateX: 400 } });

    expect(preset.zoom.level).toBe(8);
    expect(preset.zoom.rotateX).toBe(30);
  });
});

describe("the stored list", () => {
  it("refuses an id that is not a bare name", () => {
    // The media protocol serves a card by its id, so an id is a file name.
    expect(sanitiseScenePreset(stored({ id: "../../evil" }))).toBeNull();
    expect(sanitiseScenePreset(stored({ id: "Has Spaces" }))).toBeNull();
    expect(sanitiseScenePreset(stored({ name: "   " }))).toBeNull();
  });

  it("drops the one it cannot read rather than the list", () => {
    // A bad entry in a published catalogue should cost that entry, not the
    // picker.
    const presets = sanitiseScenePresets({
      version: SCENE_PRESETS_VERSION,
      presets: [stored({ id: "good" }), stored({ id: "../bad" })],
    });

    expect(presets.map((preset) => preset.id)).toEqual(["good"]);
  });

  it("ignores a list from a version it does not understand", () => {
    // Rather than throwing. A short picker is a much better outcome than an
    // editor that will not open because we published a new field.
    expect(
      sanitiseScenePresets({ version: SCENE_PRESETS_VERSION + 1, presets: [stored()] }),
    ).toEqual([]);
  });

  it("puts the newest first, which is the whole ordering", () => {
    const presets = sanitiseScenePresets({
      version: SCENE_PRESETS_VERSION,
      presets: [stored({ id: "old", savedAt: 1 }), stored({ id: "new", savedAt: 9 })],
    });

    expect(presets.map((preset) => preset.id)).toEqual(["new", "old"]);
  });
});
