import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BACKGROUND_CATEGORIES,
  BACKGROUND_CATEGORY_LABELS,
  BACKGROUND_PRESETS,
  backgroundPreset,
  backgroundsIn,
} from "./backgrounds";

describe("the background catalogue", () => {
  it("puts every preset in a group the picker shows", () => {
    // The picker walks the categories and asks each for its presets, so one
    // with a category nobody lists is an image that quietly cannot be chosen.
    const shown = BACKGROUND_CATEGORIES.flatMap((category) => backgroundsIn(category));

    expect(shown).toHaveLength(BACKGROUND_PRESETS.length);
    for (const preset of BACKGROUND_PRESETS) {
      expect(BACKGROUND_CATEGORIES).toContain(preset.category);
    }
  });

  it("ships the picture a fresh project opens on", () => {
    // `DEFAULT_BACKGROUND` names this file, and `withBackground` copies it into
    // every new recording. A preset that stopped existing would leave the first
    // frame anyone sees blank.
    expect(BACKGROUND_PRESETS.some((preset) => preset.file === "monterey.jpg")).toBe(true);
  });

  it("ships a file for every preset", () => {
    // A preset naming a file that is not in `resources/backgrounds` is a swatch
    // that draws nothing and a background that renders blank — which is exactly
    // how the missing desktop picture behaved, and it took a log line from four
    // days earlier to work out why.
    //
    // That directory is generated and git-ignored, so `pnpm test` runs
    // `sync-backgrounds.mjs` first, the way `build` and `package` do. This
    // therefore checks the script's own output: the floor it copies has to
    // cover every preset shipped here, and nothing else keeps the two in step.
    const dir = new URL("../../resources/backgrounds/", import.meta.url);

    for (const preset of BACKGROUND_PRESETS) {
      expect(existsSync(new URL(preset.file, dir))).toBe(true);
    }
  });

  it("leaves no group empty", () => {
    // A heading with nothing under it is worse than no heading.
    for (const category of BACKGROUND_CATEGORIES) {
      expect(backgroundsIn(category).length).toBeGreaterThan(0);
      expect(BACKGROUND_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it("keeps ids and files unique", () => {
    // An id is what a project stores, and a file is what gets copied into a
    // recording. A duplicate of either resolves to the wrong picture.
    expect(new Set(BACKGROUND_PRESETS.map((p) => p.id)).size).toBe(BACKGROUND_PRESETS.length);
    expect(new Set(BACKGROUND_PRESETS.map((p) => p.file)).size).toBe(BACKGROUND_PRESETS.length);
  });

  it("finds a preset by the id a project stored", () => {
    expect(backgroundPreset("monterey")?.file).toBe("monterey.jpg");
    expect(backgroundPreset("no-such-preset")).toBeUndefined();
  });
});
