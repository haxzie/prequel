/**
 * The catalogue, and the numbers it shares with two shaders it cannot import.
 *
 * The index test writes out numbers that are also written out in
 * `crates/prequel-render/src/plan.rs` and switched on in both shaders. That is
 * deliberate and is the only guard available: nothing compiles across the
 * boundary, so a table on each side and a test on each side naming the same
 * numbers is what keeps them honest — the discipline `filters.test.ts` uses.
 */
import { describe, expect, it } from "vitest";

import {
  CLICK_EFFECTS,
  CLICK_EFFECT_IDS,
  NO_CLICK_EFFECT,
  clickEffect,
  clickEffectId,
} from "./click-effects";

describe("the catalogue", () => {
  it("gives every mark a label, a hint and a colour", () => {
    for (const id of CLICK_EFFECT_IDS) {
      expect(CLICK_EFFECTS[id].label.length, id).toBeGreaterThan(0);
      expect(CLICK_EFFECTS[id].hint.length, id).toBeGreaterThan(0);
      // Six hex digits: the colour is written straight into a setting the
      // colour field edits, and that field only reads this shape.
      expect(CLICK_EFFECTS[id].color, id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("numbers the arms the way the shaders and plan.rs do", () => {
    // Hand-kept on three sides. Change one, change all four places.
    expect(CLICK_EFFECTS.ripple.index).toBe(0);
    expect(CLICK_EFFECTS.sonar.index).toBe(1);
    expect(CLICK_EFFECTS.orb.index).toBe(2);
    expect(CLICK_EFFECTS.pressure.index).toBe(3);
    expect(CLICK_EFFECTS.burst.index).toBe(4);
    expect(CLICK_EFFECTS.confetti.index).toBe(5);
    expect(CLICK_EFFECTS.target.index).toBe(6);
    expect(CLICK_EFFECTS.heart.index).toBe(7);
    expect(CLICK_EFFECTS["pixel-ring"].index).toBe(8);
    expect(CLICK_EFFECTS.ink.index).toBe(9);
    expect(CLICK_EFFECTS.halo.index).toBe(10);
    expect(CLICK_EFFECTS.tap.index).toBe(11);
    expect(CLICK_EFFECTS.chalk.index).toBe(12);
  });

  it("gives every arm its own number, with no gaps", () => {
    // A gap would be an arm the shader switches on and nothing can choose; a
    // repeat would be two marks drawn the same.
    const indices = CLICK_EFFECT_IDS.map((id) => CLICK_EFFECTS[id].index).sort((a, b) => a - b);
    expect(indices).toEqual(indices.map((_, i) => i));
  });

  it("keeps every mark short enough to read as a click", () => {
    // Under a second, over a few frames. Longer reads as an animation that
    // happened to start on the click; shorter is not seen at 30fps.
    for (const id of CLICK_EFFECT_IDS) {
      const ms = CLICK_EFFECTS[id].duration / 1_000_000;
      expect(ms, id).toBeGreaterThanOrEqual(250);
      expect(ms, id).toBeLessThanOrEqual(800);
    }
  });
});

describe("clickEffect", () => {
  it("draws nothing for none, nothing, or a mark this build lacks", () => {
    expect(clickEffect(NO_CLICK_EFFECT)).toBeNull();
    expect(clickEffect(null)).toBeNull();
    expect(clickEffect(undefined)).toBeNull();
    expect(clickEffect("")).toBeNull();
    expect(clickEffect("glitter")).toBeNull();
    // And is not fooled by a name every object has.
    expect(clickEffect("toString")).toBeNull();
  });

  it("answers for every id in the catalogue", () => {
    for (const id of CLICK_EFFECT_IDS) {
      expect(clickEffect(id)).toBe(CLICK_EFFECTS[id]);
      expect(clickEffectId(id)).toBe(id);
    }
    expect(clickEffectId("glitter")).toBe(NO_CLICK_EFFECT);
  });
});
