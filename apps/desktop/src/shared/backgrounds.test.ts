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

  it("shows five wallpapers", () => {
    expect(backgroundsIn("wallpapers")).toHaveLength(5);
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
    expect(backgroundPreset("aurora")?.file).toBe("aurora.jpg");
    expect(backgroundPreset("no-such-preset")).toBeUndefined();
  });
});
