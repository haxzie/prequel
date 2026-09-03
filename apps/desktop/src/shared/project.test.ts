/**
 * Inheritance, and surviving a file that has been edited by hand.
 *
 * The override predicate is used three times over — the dot next to a control,
 * the reset button beside it, and the section reset — so if it is wrong they
 * are all wrong together, and in a way that quietly discards the user's edits.
 */
import { describe, expect, it } from "vitest";

import {
  clearOverride,
  clearSection,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  DEFAULT_ZOOM,
  hasOverrides,
  newProject,
  outputFrame,
  overriddenKeys,
  PROJECT_VERSION,
  resolveSettings,
  sanitiseProject,
  setOverride,
  type SliceOverrides,
} from "./project.js";
import { AUTO_PRESET_ID } from "./presets.js";

const S = 1_000_000_000;
const RECORDING = "2026-08-11T12-00-00";

describe("resolveSettings", () => {
  it("falls back to the project defaults", () => {
    expect(resolveSettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings(DEFAULT_SETTINGS, undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("takes only the keys a slice overrides", () => {
    const overrides: SliceOverrides = { layout: { cameraX: 0.85 } };
    const resolved = resolveSettings(DEFAULT_SETTINGS, overrides);

    expect(resolved.layout.cameraX).toBe(0.85);
    // Everything else still follows the default.
    expect(resolved.layout.cameraHeight).toBe(DEFAULT_SETTINGS.layout.cameraHeight);
    expect(resolved.background).toEqual(DEFAULT_SETTINGS.background);
  });

  it("merges each section independently", () => {
    const resolved = resolveSettings(DEFAULT_SETTINGS, {
      layout: { cameraVisible: false },
      audio: { micMuted: true },
    });

    expect(resolved.layout.cameraVisible).toBe(false);
    expect(resolved.audio.micMuted).toBe(true);
    expect(resolved.audio.systemVolume).toBe(DEFAULT_SETTINGS.audio.systemVolume);
  });

  it("does not mutate the defaults it merges over", () => {
    const defaults = structuredClone(DEFAULT_SETTINGS);
    resolveSettings(defaults, { layout: { cameraVisible: false } });
    expect(defaults.layout.cameraVisible).toBe(true);
  });
});

describe("override bookkeeping", () => {
  it("records an override even when it equals the default", () => {
    // Anything cleverer means an edit the user made is silently not stored, and
    // the next change to the project defaults moves a slice they had decided
    // about.
    const overrides = setOverride(
      {},
      "layout",
      "cameraVisible",
      DEFAULT_SETTINGS.layout.cameraVisible,
    );

    expect(overriddenKeys(overrides, "layout").has("cameraVisible")).toBe(true);
  });

  it("reports exactly the keys that are set", () => {
    const overrides = setOverride(
      setOverride({}, "layout", "cameraHeight", 0.4),
      "layout",
      "cameraMirror",
      false,
    );

    expect([...overriddenKeys(overrides, "layout")].sort()).toEqual([
      "cameraHeight",
      "cameraMirror",
    ]);
    expect(overriddenKeys(overrides, "background").size).toBe(0);
  });

  it("clears one key without touching its neighbours", () => {
    // The reason every setting is a flat leaf: a nested group would make this
    // clear the whole group.
    const overrides = setOverride(
      setOverride({}, "layout", "cameraHeight", 0.4),
      "layout",
      "cameraMirror",
      false,
    );
    const cleared = clearOverride(overrides, "layout", "cameraHeight");

    expect(overriddenKeys(cleared, "layout").has("cameraHeight")).toBe(false);
    expect(overriddenKeys(cleared, "layout").has("cameraMirror")).toBe(true);
  });

  it("drops a section once its last key is cleared", () => {
    // So "does this slice override anything?" stays an emptiness check rather
    // than a walk looking for empty objects.
    const overrides = setOverride({}, "audio", "micMuted", true);
    const cleared = clearOverride(overrides, "audio", "micMuted");

    expect(cleared.audio).toBeUndefined();
    expect(hasOverrides(cleared)).toBe(false);
  });

  it("clears a whole section", () => {
    const overrides = setOverride(
      setOverride({}, "layout", "cameraHeight", 0.4),
      "audio",
      "micMuted",
      true,
    );
    const cleared = clearSection(overrides, "layout");

    expect(cleared.layout).toBeUndefined();
    expect(cleared.audio).toBeDefined();
  });

  it("clearing something not set is a no-op", () => {
    const overrides = setOverride({}, "layout", "cameraHeight", 0.4);
    expect(clearOverride(overrides, "layout", "cameraMirror")).toBe(overrides);
    expect(clearSection(overrides, "audio")).toBe(overrides);
  });

  it("does not mutate the overrides it is given", () => {
    const overrides = setOverride({}, "layout", "cameraHeight", 0.4);
    clearOverride(overrides, "layout", "cameraHeight");
    expect(overriddenKeys(overrides, "layout").has("cameraHeight")).toBe(true);
  });
});

describe("outputFrame", () => {
  it("scales the shorter edge, whichever edge that is", () => {
    // The whole point of measuring the shorter edge: "720p" has to be the same
    // amount of detail in portrait as in landscape. Pinning the height instead
    // would make the 9:16 export four times the pixels of the 16:9 one under
    // the same label.
    expect(outputFrame({ width: 1920, height: 1080 }, 720)).toEqual({ width: 1280, height: 720 });
    expect(outputFrame({ width: 1080, height: 1920 }, 720)).toEqual({ width: 720, height: 1280 });
  });

  it("never upscales", () => {
    // Four times the encode for pixels that carry no more detail than the
    // frame already had.
    expect(outputFrame({ width: 1280, height: 720 }, 1080)).toEqual({ width: 1280, height: 720 });
    expect(outputFrame({ width: 1280, height: 720 }, null)).toEqual({ width: 1280, height: 720 });
  });

  it("always lands on even dimensions", () => {
    // H.264 chroma subsampling needs them, and encoders round silently — which
    // shows up much later as an export one pixel narrower than its plan.
    const scaled = outputFrame({ width: 1918, height: 1078 }, 480);

    expect(scaled.width % 2).toBe(0);
    expect(scaled.height % 2).toBe(0);
  });
});

describe("newProject", () => {
  it("starts as one slice covering the whole take", () => {
    const project = newProject(RECORDING, 10 * S);
    const slices = project.tracks[0]!.slices;

    expect(slices).toHaveLength(1);
    expect(slices[0]!.source).toEqual({ start: 0, end: 10 * S });
    expect(slices[0]!.overrides).toEqual({});
  });

  it("opens on a frame that follows the recording", () => {
    // Automatic, so the footage fits the frame end to end rather than being
    // letterboxed into a fixed 16:9 the moment the editor opens. The size here
    // is only a placeholder — the editor fills it in from the screen track.
    expect(newProject(RECORDING, S).frame.presetId).toBe(AUTO_PRESET_ID);
  });

  it("gives each project its own settings to mutate", () => {
    const a = newProject(RECORDING, S);
    const b = newProject(RECORDING, S);

    a.defaults.layout.cameraVisible = false;
    expect(b.defaults.layout.cameraVisible).toBe(true);
  });

  it("opens a whole screen filling the frame", () => {
    // A window or a region is an object with edges and reads as one when it is
    // inset on a background. A whole screen already fills the frame it was
    // recorded in, and insetting it puts a border of desktop picture around a
    // picture of a desktop while shrinking the thing being demonstrated.
    const project = newProject(RECORDING, S, true);

    expect(project.defaults.background.padding).toBe(0);
    // The radius goes with it. Kept on a full-bleed picture it cuts four
    // notches out of the corners with the background showing through, which
    // reads as a bug rather than as a choice.
    expect(project.defaults.background.cornerRadius).toBe(0);
  });

  it("still frames anything else on a background", () => {
    const project = newProject(RECORDING, S, false);

    expect(project.defaults.background.padding).toBeGreaterThan(0);
    expect(project.defaults.background.cornerRadius).toBeGreaterThan(0);
  });
});

describe("sanitiseProject", () => {
  const stored = () => JSON.parse(JSON.stringify(newProject(RECORDING, 10 * S))) as unknown;

  it("reads back what it wrote", () => {
    expect(sanitiseProject(stored(), RECORDING, 10 * S)).toEqual(newProject(RECORDING, 10 * S));
  });

  it("refuses a project from an incompatible version", () => {
    const project = stored() as { version: number };
    project.version = PROJECT_VERSION + 1;

    expect(sanitiseProject(project, RECORDING, 10 * S)).toBeNull();
  });

  it("refuses a project belonging to a different recording", () => {
    // Cuts measured against a timeline this take does not have.
    expect(sanitiseProject(stored(), "some-other-recording", 10 * S)).toBeNull();
  });

  it("refuses something that is not an object at all", () => {
    expect(sanitiseProject(null, RECORDING, S)).toBeNull();
    expect(sanitiseProject("{}", RECORDING, S)).toBeNull();
  });

  it("translates an arrangement that has been taken out of the grid", () => {
    // `layoutBoxes` answers for the arrangements that exist. A project naming
    // one that does not gets no boxes at all — the editor opens on an empty
    // frame, which reads as lost footage rather than as a preset that was
    // removed. So the name is translated on the way in, in the defaults and in
    // a slice's overrides alike.
    const project = stored() as {
      defaults: { layout: { preset: string } };
      tracks: { slices: { overrides: { layout?: { preset: string } } }[] }[];
    };
    project.defaults.layout.preset = "beside-flush";
    project.tracks[0]!.slices[0]!.overrides.layout = { preset: "split-stacked" };

    const repaired = sanitiseProject(project, RECORDING, 10 * S)!;

    expect(repaired.defaults.layout.preset).toBe("beside");
    expect(repaired.tracks[0]!.slices[0]!.overrides.layout?.preset).toBe("stacked");
  });

  it("repairs a frame size rather than refusing the file", () => {
    const project = stored() as { frame: { width: unknown; height: unknown } };
    project.frame.width = "wide";
    project.frame.height = 1081; // odd — H.264 cannot encode it

    const repaired = sanitiseProject(project, RECORDING, 10 * S)!;

    expect(repaired.frame.width).toBe(1920);
    expect(repaired.frame.height).toBe(1080);
  });

  it("clamps slices to the recording that actually exists", () => {
    // A project written against a longer take — or a truncated recording.
    const project = stored() as { tracks: { slices: { source: { end: number } }[] }[] };
    project.tracks[0]!.slices[0]!.source.end = 999 * S;

    const repaired = sanitiseProject(project, RECORDING, 10 * S)!;

    expect(repaired.tracks[0]!.slices[0]!.source.end).toBe(10 * S);
  });

  it("drops slices that clamp to nothing", () => {
    const project = stored() as { tracks: { slices: unknown[] }[] };
    project.tracks[0]!.slices = [
      { id: "empty", source: { start: 5 * S, end: 5 * S }, overrides: {} },
      { id: "real", source: { start: 0, end: 4 * S }, overrides: {} },
    ];

    const repaired = sanitiseProject(project, RECORDING, 10 * S)!;

    expect(repaired.tracks[0]!.slices.map((slice) => slice.id)).toEqual(["real"]);
  });

  it("falls back to the whole take when every slice is unusable", () => {
    // Everything cut away is recoverable by adding slices back; a project with
    // none at all is not something the editor can show.
    const project = stored() as { tracks: { slices: unknown[] }[] };
    project.tracks[0]!.slices = [];

    const repaired = sanitiseProject(project, RECORDING, 10 * S)!;

    expect(repaired.tracks[0]!.slices).toHaveLength(1);
    expect(repaired.tracks[0]!.slices[0]!.source).toEqual({ start: 0, end: 10 * S });
  });

  it("fills in settings a partial file is missing", () => {
    const project = stored() as { defaults: { layout: unknown; background?: unknown } };
    project.defaults.layout = { cameraX: 0.85 };
    delete project.defaults.background;

    const repaired = sanitiseProject(project, RECORDING, 10 * S)!;

    expect(repaired.defaults.layout.cameraX).toBe(0.85);
    expect(repaired.defaults.layout.cameraHeight).toBe(DEFAULT_SETTINGS.layout.cameraHeight);
    expect(repaired.defaults.background).toEqual(DEFAULT_SETTINGS.background);
  });

  it("clamps an implausible frame rate and unknown format", () => {
    const project = stored() as { output: { fps: number; format: string } };
    project.output = { fps: 100_000, format: "vp9" };

    const repaired = sanitiseProject(project, RECORDING, 10 * S)!;

    expect(repaired.output.fps).toBe(120);
    expect(repaired.output.format).toBe("h264");
  });

  it("holds a GIF to a size the format can carry", () => {
    // A GIF stores a whole frame at a time, so "Full" on a 4K recording is a
    // file measured in gigabytes. The dialog does not offer it; this stops a
    // project that names it anyway from exporting one.
    const project = stored() as { output: unknown };
    project.output = { fps: 20, format: "gif", shortEdge: null };

    expect(sanitiseProject(project, RECORDING, 10 * S)!.output.shortEdge).toBe(720);
  });

  it("reads a pre-GIF project's codec as its format", () => {
    // `format` was called `codec` before GIF joined it. Ignoring the old key
    // would not fail anything — it would quietly move every existing HEVC
    // project back to H.264 the first time it was opened.
    const project = stored() as { output: unknown };
    project.output = { fps: 60, codec: "hevc" };

    expect(sanitiseProject(project, RECORDING, 10 * S)!.output.format).toBe("hevc");
  });

  it("keeps per-slice overrides across a round trip", () => {
    const project = newProject(RECORDING, 10 * S);
    project.tracks[0]!.slices[0]!.overrides = { layout: { cameraX: 0.85 } };

    const repaired = sanitiseProject(JSON.parse(JSON.stringify(project)), RECORDING, 10 * S)!;

    expect(repaired.tracks[0]!.slices[0]!.overrides).toEqual({
      layout: { cameraX: 0.85 },
    });
  });
});

describe("reading a project written before the camera could shrink", () => {
  /**
   * `cameraShrinkOnZoom` is on for a new project — it is the better default and
   * the reason it exists. But `sanitiseProject` spreads what is on disk over
   * `DEFAULT_LAYOUT`, so a key nobody ever wrote takes that default, and every
   * recording already edited would reopen with its bubble moving in a way its
   * author never asked for. The rule `perspective` and `vignette` were
   * defaulted by holds here: a new field reads back the way the project looked
   * when it was saved.
   */
  const opened = (layout: Record<string, unknown>) => {
    const project = JSON.parse(JSON.stringify(newProject(RECORDING, 10 * S)));
    project.defaults.layout = layout;
    return sanitiseProject(project, RECORDING, 10 * S)!.defaults.layout;
  };

  it("leaves a project that predates it looking the way it did", () => {
    const { cameraShrinkOnZoom: _dropped, ...before } = newProject(RECORDING, 10 * S).defaults
      .layout as unknown as Record<string, unknown>;

    expect(opened(before).cameraShrinkOnZoom).toBe(false);
    // Still the default, so switching it on reads as the size it would have.
    expect(opened(before).cameraShrinkTo).toBe(DEFAULT_LAYOUT.cameraShrinkTo);
  });

  it("keeps what a project written since then says, either way", () => {
    expect(opened({ cameraShrinkOnZoom: true }).cameraShrinkOnZoom).toBe(true);
    expect(opened({ cameraShrinkOnZoom: false }).cameraShrinkOnZoom).toBe(false);
  });

  it("starts a new project with it on", () => {
    expect(newProject(RECORDING, 10 * S).defaults.layout.cameraShrinkOnZoom).toBe(true);
  });

  it("does not make every slice look like it overrides it", () => {
    // `migrateLayout` runs over a slice's overrides as well as the defaults, so
    // writing the key there would make `key in overrides.layout` answer yes for
    // a clip that overrides nothing — and the panel would show a shrink set on
    // clips nobody touched.
    const project = JSON.parse(JSON.stringify(newProject(RECORDING, 10 * S)));
    project.tracks[0].slices[0].overrides = { layout: { cameraZoom: 1.5 } };

    const slice = sanitiseProject(project, RECORDING, 10 * S)!.tracks[0]!.slices[0]!;
    expect(Object.keys(slice.overrides.layout ?? {})).toEqual(["cameraZoom"]);
  });
});

describe("reading a project written before the perspective rename", () => {
  /**
   * `tilt`, `yaw` and `depth` are what `rotateX`, `rotateY` and `perspective`
   * were called on disk until they were renamed for the axes they turn about.
   *
   * The version is deliberately not bumped, for the reason the block below
   * gives: a mismatch makes `sanitiseProject` start fresh, and throwing away
   * every project on disk to rename three keys is a far worse outcome than
   * reading both spellings. Without the fallback the values stay in the file
   * and nothing reads them — so a recording somebody leaned by hand reopens
   * flat, with no error and no way to tell what happened.
   */
  const zoomedBy = (zoom: Record<string, unknown>) => {
    const project = JSON.parse(JSON.stringify(newProject(RECORDING, 10 * S)));
    project.zooms = [{ id: "z1", source: { start: 0, end: 2 * S }, ...zoom }];
    return sanitiseProject(project, RECORDING, 10 * S)!.zooms[0]!;
  };

  it("reads the old names", () => {
    const zoom = zoomedBy({ tilt: 12, yaw: -14, depth: 0.8 });

    expect(zoom.rotateX).toBe(12);
    expect(zoom.rotateY).toBe(-14);
    expect(zoom.perspective).toBe(0.8);
  });

  it("prefers the new name when a project carries both", () => {
    // What a project written by this build and then opened by an older one and
    // written again would look like. The new name is the one being maintained.
    const zoom = zoomedBy({ tilt: 12, rotateX: 4, yaw: -14, rotateY: -2, depth: 0.8 });

    expect(zoom.rotateX).toBe(4);
    expect(zoom.rotateY).toBe(-2);
  });

  it("still clamps a value that arrives under the old name", () => {
    // The fallback feeds the same clamp, or an old file could set an angle the
    // interface cannot reach and the picture becomes foreshortening.
    expect(zoomedBy({ tilt: 400 }).rotateX).toBe(30);
    expect(zoomedBy({ depth: -3 }).perspective).toBe(0);
  });

  it("falls back to the default when neither name is there", () => {
    const zoom = zoomedBy({});

    expect(zoom.rotateX).toBe(DEFAULT_ZOOM.rotateX);
    expect(zoom.perspective).toBe(DEFAULT_ZOOM.perspective);
  });
});

describe("reading a project written before layouts", () => {
  // The version is deliberately not bumped for this — a mismatch makes
  // `sanitiseProject` start fresh, which would throw away every project on disk
  // to rename two keys. So the old names have to be understood here instead,
  // and every one of these is a look somebody had already settled on.
  const before = (layout: Record<string, unknown>) => {
    const project = JSON.parse(JSON.stringify(newProject(RECORDING, 10 * S)));
    project.defaults.layout = layout;
    return sanitiseProject(project, RECORDING, 10 * S)!;
  };

  it("reads Fill as the full-bleed arrangement", () => {
    expect(before({ screenFit: "cover" }).defaults.layout.preset).toBe("over-full");
  });

  it("reads Fit as the padded one", () => {
    expect(before({ screenFit: "contain" }).defaults.layout.preset).toBe("over-padded");
  });

  it("reads a hidden camera as the screen-only arrangement", () => {
    // Both draw the same picture, but only one of them lights the cell in the
    // picker that matches what is on screen.
    expect(before({ screenFit: "contain", cameraVisible: false }).defaults.layout.preset).toBe(
      "screen-padded",
    );
    expect(before({ screenFit: "cover", cameraVisible: false }).defaults.layout.preset).toBe(
      "screen-full",
    );
  });

  it("gives the bubble the size it had, and the width its shape implied", () => {
    const square = before({ cameraSize: 0.42, cameraShape: "squircle" }).defaults.layout;
    expect(square.cameraHeight).toBe(0.42);
    expect(square.cameraWidth).toBe(0.42);

    const wide = before({ cameraSize: 0.42, cameraShape: "wide" }).defaults.layout;
    expect(wide.cameraHeight).toBe(0.42);
    expect(wide.cameraWidth).toBeCloseTo((0.42 * 16) / 9);
  });

  it("leaves the old keys behind rather than carrying them along", () => {
    const layout = before({ screenFit: "cover", cameraSize: 0.42 }).defaults.layout;

    expect(layout).not.toHaveProperty("screenFit");
    expect(layout).not.toHaveProperty("cameraSize");
  });

  it("carries a slice's own choice across, and nothing else with it", () => {
    const project = JSON.parse(JSON.stringify(newProject(RECORDING, 10 * S)));
    project.tracks[0].slices[0].overrides = {
      layout: { screenFit: "cover", cameraSize: 0.5 },
      audio: { micMuted: true },
    };

    const { overrides } = sanitiseProject(project, RECORDING, 10 * S)!.tracks[0]!.slices[0]!;

    // Still overridden, so resetting one of them is still a thing this slice
    // can do — a migration that dropped them would quietly move the clip back
    // to whatever the project defaults happen to say.
    expect([...overriddenKeys(overrides, "layout")].sort()).toEqual([
      "cameraHeight",
      "cameraWidth",
      "preset",
    ]);
    expect(overrides.layout!.preset).toBe("over-full");
    expect(overrides.audio).toEqual({ micMuted: true });
  });

  it("does not invent an override for a slice that had none", () => {
    const project = JSON.parse(JSON.stringify(newProject(RECORDING, 10 * S)));
    project.tracks[0].slices[0].overrides = { layout: {} };

    const { overrides } = sanitiseProject(project, RECORDING, 10 * S)!.tracks[0]!.slices[0]!;

    expect(overrides.layout).toBeUndefined();
  });
});
