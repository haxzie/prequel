import { describe, expect, it } from "vitest";

import {
  TELEPROMPTER_FOOTER,
  TELEPROMPTER_LEADING,
  TELEPROMPTER_MAX_LINES,
  TELEPROMPTER_MIN_LINES,
  TELEPROMPTER_PADDING,
  TELEPROMPTER_SIZES,
  teleprompterHeight,
} from "./contract";

/**
 * Main sizes the island's window with this and the island draws itself to it.
 * The two are the same function precisely so they cannot drift — and what
 * drifting costs is the last line clipped, or a dead band under the footer,
 * on a panel nobody can resize to see it.
 */
describe("teleprompterHeight", () => {
  it("grows by exactly one line per line", () => {
    const notch = 37;
    const line = TELEPROMPTER_SIZES.medium * TELEPROMPTER_LEADING;

    for (let lines = TELEPROMPTER_MIN_LINES; lines < TELEPROMPTER_MAX_LINES; lines++) {
      const step =
        teleprompterHeight("medium", notch, lines + 1) - teleprompterHeight("medium", notch, lines);
      // Rounded, so a line of 27 pixels can land a pixel either side.
      expect(Math.abs(step - line)).toBeLessThanOrEqual(1);
    }
  });

  it("leaves room for the footer and the padding at its shortest", () => {
    // The smallest island still has to hold everything under the text. A
    // height that fitted only the lines would put the counter and the mode
    // outside the panel — visible as a footer half over the wallpaper.
    const shortest = teleprompterHeight("small", 0, TELEPROMPTER_MIN_LINES);
    const text = TELEPROMPTER_MIN_LINES * TELEPROMPTER_SIZES.small * TELEPROMPTER_LEADING;

    expect(shortest).toBeGreaterThanOrEqual(text + TELEPROMPTER_FOOTER + TELEPROMPTER_PADDING * 2);
  });

  it("adds the notch on top rather than taking the text out of it", () => {
    // The strip the island shares with the notch is bezel, not script: a
    // notched display that counted it as text would show one line fewer than
    // a plain one at the same setting.
    const plain = teleprompterHeight("large", 0, 5);
    const notched = teleprompterHeight("large", 37, 5);

    expect(notched - plain).toBe(37);
  });

  it("is tallest at the size and the line count the window is built for", () => {
    // Main sizes the window for the largest island there can be and lets the
    // panel be any smaller size inside it. Anything taller than that would be
    // drawn past the window's own edge and sliced off.
    const window = teleprompterHeight("large", 37, TELEPROMPTER_MAX_LINES);

    for (const size of ["small", "medium", "large"] as const) {
      for (let lines = TELEPROMPTER_MIN_LINES; lines <= TELEPROMPTER_MAX_LINES; lines++) {
        expect(teleprompterHeight(size, 37, lines)).toBeLessThanOrEqual(window);
      }
    }
  });
});
