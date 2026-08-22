/**
 * Chords, and the ways a remappable one goes wrong.
 *
 * Three properties matter more than any single case. Two spellings of the same
 * chord must compare equal, or rebinding to the shortcut you already have looks
 * like a conflict. Normalising twice must not change anything, because the
 * stored value is normalised on the way in and again on the way out. And a
 * chord with no real modifier must be refused, because registering one takes
 * that key away from every other application on the Mac.
 */
import { describe, expect, it } from "vitest";

import {
  acceleratorFromEvent,
  acceleratorGlyphs,
  formatAccelerator,
  isBindable,
  normaliseAccelerator,
  parseAccelerator,
} from "./accelerator.js";

/** A keydown, with every modifier off unless the test says otherwise. */
function keydown(
  code: string,
  modifiers: Partial<Record<"meta" | "ctrl" | "alt" | "shift", true>> = {},
) {
  return {
    code,
    metaKey: modifiers.meta === true,
    ctrlKey: modifiers.ctrl === true,
    altKey: modifiers.alt === true,
    shiftKey: modifiers.shift === true,
  };
}

describe("normaliseAccelerator", () => {
  it("keeps the shipped default unchanged", () => {
    // The default in DEFAULT_PREFERENCES is written in this spelling, so if
    // normalising it produced anything else every launch would look like a
    // rebind.
    expect(normaliseAccelerator("Shift+Cmd+R")).toBe("Shift+Cmd+R");
  });

  it("folds the spellings Electron accepts onto one", () => {
    for (const spelling of ["Command+Shift+R", "Cmd+Shift+R", "Super+Shift+r", "Meta+Shift+R"]) {
      expect(normaliseAccelerator(spelling)).toBe("Shift+Cmd+R");
    }
  });

  it("orders modifiers the way macOS draws them", () => {
    expect(normaliseAccelerator("Cmd+Shift+Alt+Ctrl+K")).toBe("Ctrl+Alt+Shift+Cmd+K");
  });

  it("is idempotent", () => {
    const once = normaliseAccelerator("Command+Option+2");
    expect(once).not.toBeNull();
    expect(normaliseAccelerator(once as string)).toBe(once);
  });

  it("refuses a chord with no key, or with two", () => {
    expect(normaliseAccelerator("Cmd+Shift")).toBeNull();
    expect(normaliseAccelerator("Cmd+R+T")).toBeNull();
    expect(normaliseAccelerator("")).toBeNull();
  });
});

describe("parseAccelerator", () => {
  it("splits modifiers from the key", () => {
    expect(parseAccelerator("Shift+Cmd+R")).toEqual({
      modifiers: ["Shift", "Command"],
      key: "R",
    });
  });

  it("keeps a named key whole and upper-cases a single letter", () => {
    expect(parseAccelerator("Cmd+Space")?.key).toBe("Space");
    expect(parseAccelerator("Cmd+r")?.key).toBe("R");
  });

  it("collapses a repeated modifier rather than treating it as the key", () => {
    expect(parseAccelerator("Cmd+Command+R")).toEqual({ modifiers: ["Command"], key: "R" });
  });
});

describe("isBindable", () => {
  it("accepts a chord with a real modifier", () => {
    expect(isBindable("Shift+Cmd+R")).toBe(true);
    expect(isBindable("Ctrl+R")).toBe(true);
    expect(isBindable("Alt+R")).toBe(true);
  });

  it("refuses a bare key, which would swallow it everywhere on the Mac", () => {
    expect(isBindable("R")).toBe(false);
    expect(isBindable("Space")).toBe(false);
  });

  it("refuses Shift alone, which is no better than a bare key", () => {
    expect(isBindable("Shift+R")).toBe(false);
  });
});

describe("formatAccelerator", () => {
  it("returns the keys in drawing order, with ids the renderer can swap icons for", () => {
    expect(formatAccelerator("Shift+Cmd+R")).toEqual([
      { id: "Shift", glyph: "⇧", label: "Shift" },
      { id: "Command", glyph: "⌘", label: "Command" },
      { id: "Key", glyph: "R", label: "R" },
    ]);
  });

  it("draws a named key as its glyph but keeps the name as the label", () => {
    const [, key] = formatAccelerator("Cmd+Escape");
    expect(key).toEqual({ id: "Key", glyph: "⎋", label: "Escape" });
  });

  it("is empty for an unusable accelerator, rather than drawing half a chord", () => {
    expect(formatAccelerator("Cmd+Shift")).toEqual([]);
  });

  it("glyphs join up for a plain-text surface", () => {
    expect(acceleratorGlyphs("Shift+Cmd+R")).toBe("⇧⌘R");
  });
});

describe("acceleratorFromEvent", () => {
  it("builds the canonical spelling straight from a keydown", () => {
    expect(acceleratorFromEvent(keydown("KeyR", { meta: true, shift: true }))).toBe("Shift+Cmd+R");
  });

  it("returns null while only modifiers are held", () => {
    // Otherwise holding ⌘ on the way to ⌘⇧R would commit half a chord.
    expect(acceleratorFromEvent(keydown("MetaLeft", { meta: true }))).toBeNull();
    expect(acceleratorFromEvent(keydown("ShiftRight", { shift: true }))).toBeNull();
  });

  it("reads the physical key, not what the modifiers produced", () => {
    // `event.key` for ⌥R is `®`, and something else again on another layout.
    expect(acceleratorFromEvent(keydown("KeyR", { alt: true }))).toBe("Alt+R");
  });

  it("handles digits, function keys and punctuation", () => {
    expect(acceleratorFromEvent(keydown("Digit2", { meta: true, shift: true }))).toBe(
      "Shift+Cmd+2",
    );
    expect(acceleratorFromEvent(keydown("F5", { ctrl: true }))).toBe("Ctrl+F5");
    expect(acceleratorFromEvent(keydown("Comma", { meta: true }))).toBe("Cmd+,");
  });

  it("returns null for a key Electron has no name for", () => {
    expect(acceleratorFromEvent(keydown("Fn", { meta: true }))).toBeNull();
  });

  it("round-trips through normalise, which is what the field stores", () => {
    const chord = acceleratorFromEvent(keydown("KeyK", { meta: true, alt: true, shift: true }));
    expect(chord).not.toBeNull();
    expect(normaliseAccelerator(chord as string)).toBe(chord);
  });
});
