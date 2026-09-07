import { describe, expect, it } from "vitest";

import { available, captionFont, CAPTION_FONTS, DEFAULT_FONT, leadFamily } from "./fonts";

describe("captionFont", () => {
  it("finds every face it offers", () => {
    for (const font of CAPTION_FONTS) {
      expect(captionFont(font.id)).toBe(font);
    }
  });

  it("falls back rather than throwing, so an old project still opens", () => {
    expect(captionFont("a-font-from-a-later-build")).toBe(DEFAULT_FONT);
    expect(captionFont("")).toBe(DEFAULT_FONT);
  });

  it("ends every stack in something that cannot itself be missing", () => {
    for (const font of CAPTION_FONTS) {
      expect(font.stack).toMatch(/(sans-serif|serif|monospace)$/);
    }
  });

  it("keeps ids unique, since one names a saved project's face", () => {
    expect(new Set(CAPTION_FONTS.map((f) => f.id)).size).toBe(CAPTION_FONTS.length);
  });
});

describe("leadFamily", () => {
  it("takes the family being asked about, not the fallbacks behind it", () => {
    expect(leadFamily('"Helvetica Neue", Arial, sans-serif')).toBe('"Helvetica Neue"');
    expect(leadFamily("system-ui, Arial, sans-serif")).toBe("system-ui");
  });
});

describe("available", () => {
  // The measurer stands in for canvas: it knows two families and answers the
  // same width for everything else, which is what a real engine does when it
  // falls through to the end of the stack.
  const widths: Record<string, number> = { Real: 100, Other: 120 };
  const measure = (font: string) => {
    const family = font.replace("64px ", "").split(",")[0]!.trim();
    return widths[family] ?? 80;
  };

  it("says yes when the family measures differently from nothing at all", () => {
    expect(available("Real", measure)).toBe(true);
    expect(available("Other", measure)).toBe(true);
  });

  it("says no when it measures the same, which is what falling through means", () => {
    expect(available("Imaginary", measure)).toBe(false);
  });
});
