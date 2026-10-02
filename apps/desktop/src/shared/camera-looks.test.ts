/**
 * The catalogue, and the one property that makes it safe to add to.
 *
 * Every lever is signed and centred on zero, which is what lets a strength be a
 * plain scale and lets "no look" be the absence of a grade rather than a row of
 * neutral values written down somewhere. A look added with an unsigned field —
 * a saturation of 1 meaning "unchanged", say — would fade towards black instead
 * of towards the picture, and only at strengths nobody drags to.
 */
import { describe, expect, it } from "vitest";

import { CAMERA_LOOKS, NO_GRADE, cameraLook, resolveGrade } from "./camera-looks.js";

const LEVERS = Object.keys(NO_GRADE) as (keyof typeof NO_GRADE)[];

describe("the camera looks", () => {
  it("leads with none, which does nothing", () => {
    expect(CAMERA_LOOKS[0]!.id).toBe("none");
    expect(CAMERA_LOOKS[0]!.grade).toEqual(NO_GRADE);
    expect(resolveGrade("none", 1)).toBeNull();
  });

  it("has no two looks under one id", () => {
    const ids = CAMERA_LOOKS.map((look) => look.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to none for an id it has never heard of", () => {
    // A project written by a newer build names looks this one does not have.
    // Drawing the camera plainly is a far better answer than refusing to open.
    expect(cameraLook("from-the-future").id).toBe("none");
    expect(resolveGrade("from-the-future", 1)).toBeNull();
  });

  it("draws nothing at no strength", () => {
    for (const look of CAMERA_LOOKS) {
      expect(resolveGrade(look.id, 0)).toBeNull();
    }
  });

  it("scales every amount by the strength, and holds the hues", () => {
    // The hues are directions, not amounts. Scaling one would walk the shadows
    // round the colour wheel as the slider moved, which is not what anybody
    // means by "less of this look".
    const full = resolveGrade("film", 1)!;
    const half = resolveGrade("film", 0.5)!;

    expect(half.shadowHue).toBe(full.shadowHue);
    expect(half.highlightHue).toBe(full.highlightHue);
    for (const lever of LEVERS) {
      if (lever === "shadowHue" || lever === "highlightHue") continue;
      expect(half[lever]).toBeCloseTo(full[lever] / 2, 10);
    }
  });

  it("keeps every lever in a range a face survives", () => {
    // Not a style rule. These are multipliers on somebody's skin, and a
    // temperature past about a third turns a face orange on its own — the
    // failure the warm and cool looks exist to *fix*.
    for (const look of CAMERA_LOOKS) {
      for (const lever of LEVERS) {
        const value = look.grade[lever];
        expect(Number.isFinite(value), `${look.id}.${lever}`).toBe(true);
        if (lever === "shadowHue" || lever === "highlightHue") {
          expect(value, `${look.id}.${lever}`).toBeGreaterThanOrEqual(0);
          expect(value, `${look.id}.${lever}`).toBeLessThan(1);
          continue;
        }
        expect(Math.abs(value), `${look.id}.${lever}`).toBeLessThanOrEqual(0.35);
      }
    }
  });

  it("gives every look a name and a room it is for", () => {
    for (const look of CAMERA_LOOKS) {
      expect(look.label.length, look.id).toBeGreaterThan(0);
      expect(look.note.length, look.id).toBeGreaterThan(0);
    }
  });
});
