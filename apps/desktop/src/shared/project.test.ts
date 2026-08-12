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
  DEFAULT_SETTINGS,
  hasOverrides,
  newProject,
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
    expect(resolved.layout.cameraSize).toBe(DEFAULT_SETTINGS.layout.cameraSize);
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
      setOverride({}, "layout", "cameraSize", 0.4),
      "layout",
      "cameraMirror",
      false,
    );

    expect([...overriddenKeys(overrides, "layout")].sort()).toEqual(["cameraMirror", "cameraSize"]);
    expect(overriddenKeys(overrides, "background").size).toBe(0);
  });

  it("clears one key without touching its neighbours", () => {
    // The reason every setting is a flat leaf: a nested group would make this
    // clear the whole group.
    const overrides = setOverride(
      setOverride({}, "layout", "cameraSize", 0.4),
      "layout",
      "cameraMirror",
      false,
    );
    const cleared = clearOverride(overrides, "layout", "cameraSize");

    expect(overriddenKeys(cleared, "layout").has("cameraSize")).toBe(false);
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
      setOverride({}, "layout", "cameraSize", 0.4),
      "audio",
      "micMuted",
      true,
    );
    const cleared = clearSection(overrides, "layout");

    expect(cleared.layout).toBeUndefined();
    expect(cleared.audio).toBeDefined();
  });

  it("clearing something not set is a no-op", () => {
    const overrides = setOverride({}, "layout", "cameraSize", 0.4);
    expect(clearOverride(overrides, "layout", "cameraMirror")).toBe(overrides);
    expect(clearSection(overrides, "audio")).toBe(overrides);
  });

  it("does not mutate the overrides it is given", () => {
    const overrides = setOverride({}, "layout", "cameraSize", 0.4);
    clearOverride(overrides, "layout", "cameraSize");
    expect(overriddenKeys(overrides, "layout").has("cameraSize")).toBe(true);
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
    expect(repaired.defaults.layout.cameraSize).toBe(DEFAULT_SETTINGS.layout.cameraSize);
    expect(repaired.defaults.background).toEqual(DEFAULT_SETTINGS.background);
  });

  it("clamps an implausible frame rate and unknown codec", () => {
    const project = stored() as { output: { fps: number; codec: string } };
    project.output = { fps: 100_000, codec: "vp9" };

    const repaired = sanitiseProject(project, RECORDING, 10 * S)!;

    expect(repaired.output.fps).toBe(120);
    expect(repaired.output.codec).toBe("h264");
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
