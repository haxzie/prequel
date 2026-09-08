/**
 * That every pointer the editor offers has artwork behind it.
 *
 * The failure this catches is quiet and total: `cursorLayer` copies
 * `CURSOR_FILES` into a recording on open and gives up on the first one it
 * cannot find, so a style naming a missing PNG is not a style that draws wrong
 * — it is a recording that opens with no pointer at all, which reads as a take
 * captured with the cursor hidden.
 *
 * The same guard `backgrounds.test.ts` keeps over the shipped wallpapers, and
 * for the same reason: the list and the folder are edited separately.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURSOR_FILES, CURSOR_STYLES, cursorImages, cursorStyle } from "./contract";

const RESOURCES = fileURLToPath(new URL("../../resources", import.meta.url));

describe("the pointers", () => {
  it("ships a file for every image any style asks for", () => {
    const missing = CURSOR_FILES.filter((file) => !existsSync(join(RESOURCES, file)));
    expect(missing).toEqual([]);
  });

  it("gives every style an arrow, which is what a missing kind falls back to", () => {
    // `cursorImages` draws the arrow for any kind a style does not ship, so a
    // style without one has nothing to draw for a pointer over a link.
    for (const style of CURSOR_STYLES) {
      expect(cursorImages(style.id).shapes.arrow).toBeDefined();
    }
  });

  it("keeps every hotspot inside its own picture", () => {
    // A hotspot outside the artwork puts the pointer's acting point somewhere
    // the drawing is not, which reads as the cursor lagging its own clicks.
    for (const style of CURSOR_STYLES) {
      for (const shape of Object.values(style.shapes)) {
        expect(shape.hotspot.x).toBeGreaterThanOrEqual(0);
        expect(shape.hotspot.x).toBeLessThanOrEqual(1);
        expect(shape.hotspot.y).toBeGreaterThanOrEqual(0);
        expect(shape.hotspot.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it("has no two styles sharing an id", () => {
    // `cursorStyle` finds by id and answers with the first match, so a repeat
    // would be a style nobody can select — the picker would show two cells and
    // light the same one.
    const ids = CURSOR_STYLES.map((style) => style.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to the default for an id it does not know", () => {
    expect(cursorStyle("not-a-style").id).toBe(CURSOR_STYLES[0].id);
  });
});
