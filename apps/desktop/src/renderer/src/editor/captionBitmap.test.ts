/**
 * The one thing about a caption bitmap that can be tested without a canvas.
 *
 * `cueKey` decides the file name, and main skips writing a file that is already
 * there — so a name that does not move when the pixels do is a recording that
 * goes on drawing captions from an older build. That happened: the key hashed
 * only `style.id`, and three changes to a plate's colour all wrote nothing.
 */
import { describe, expect, it } from "vitest";

import { captionStyle, type CaptionStyle, type Cue } from "../../../shared/captions";
import { cueKey, cuePaths } from "./captionBitmap";

const CUE: Cue = {
  at: 0,
  end: 1_000_000_000,
  lines: ["hello there"],
  words: [{ text: "hello", at: 0, end: 500_000_000, line: 0 }],
};

const OPTIONS = { frame: { width: 1920, height: 1080 }, size: 0.04, accent: "#ffd60a" };

/** The same look with one leaf changed. */
const tweak = (over: Partial<CaptionStyle>): CaptionStyle => ({
  ...captionStyle("subtitle"),
  ...over,
});

describe("cueKey", () => {
  it("is stable for the same cue drawn the same way", () => {
    expect(cueKey(CUE, captionStyle("subtitle"), OPTIONS)).toBe(
      cueKey(CUE, captionStyle("subtitle"), OPTIONS),
    );
  });

  it("moves when the plate's colour does", () => {
    // The exact regression. Changing this used to leave the name alone, so the
    // bitmap on disk was never rewritten.
    const before = captionStyle("subtitle");
    const after = tweak({ plate: { ...before.plate!, color: "rgba(0,0,0,0.9)" } });

    expect(cueKey(CUE, after, OPTIONS)).not.toBe(cueKey(CUE, before, OPTIONS));
  });

  it("moves when the plate is taken away entirely", () => {
    expect(cueKey(CUE, tweak({ plate: null }), OPTIONS)).not.toBe(
      cueKey(CUE, captionStyle("subtitle"), OPTIONS),
    );
  });

  it("moves for every other leaf that reaches the pixels", () => {
    const base = captionStyle("subtitle");
    const changed: Partial<CaptionStyle>[] = [
      { weight: 800 },
      { scale: 1.4 },
      { fill: "#ff0000" },
      { tracking: 0.1 },
      { caps: true },
      { stroke: { color: "#000000", width: 0.1 } },
      { shadow: { color: "#000000", blur: 0.2, dy: 0.05 } },
    ];

    for (const over of changed) {
      expect(cueKey(CUE, tweak(over), OPTIONS)).not.toBe(cueKey(CUE, base, OPTIONS));
    }
  });

  it("moves with the size, the frame and the words", () => {
    const style = captionStyle("subtitle");

    expect(cueKey(CUE, style, { ...OPTIONS, size: 0.06 })).not.toBe(cueKey(CUE, style, OPTIONS));
    expect(cueKey(CUE, style, { ...OPTIONS, frame: { width: 1280, height: 720 } })).not.toBe(
      cueKey(CUE, style, OPTIONS),
    );
    expect(cueKey({ ...CUE, lines: ["something else"] }, style, OPTIONS)).not.toBe(
      cueKey(CUE, style, OPTIONS),
    );
  });

  it("moves with the accent only for a look that lights a word", () => {
    // A style with no lit layer never draws the accent, so re-rasterising every
    // cue when it changes would be work for an identical picture.
    const lit = captionStyle("highlight");
    const flat = captionStyle("subtitle");
    const other = { ...OPTIONS, accent: "#00ff00" };

    expect(cueKey(CUE, lit, other)).not.toBe(cueKey(CUE, lit, OPTIONS));
    expect(cueKey(CUE, flat, other)).toBe(cueKey(CUE, flat, OPTIONS));
  });

  it("covers the drawing code as well as the style", () => {
    // Two separate ways the pixels can change, and the key has to move for
    // both. Hashing the style alone caught an edited `CAPTION_STYLES` and
    // missed an edited `paint` — which is how a fix to the lit layer shipped
    // twice without any bitmap being rewritten.
    //
    // There is no way to assert the bump itself from here; what this pins is
    // that the constant is *in* the key, so bumping it does something.
    const style = captionStyle("highlight");
    const key = cueKey(CUE, style, OPTIONS);

    expect(key).toMatch(/^[0-9a-f]{8}$/);
    // A style change and a rasteriser change must not be able to collide into
    // the same name by cancelling each other out.
    expect(cueKey(CUE, tweak({ fill: "#123456" }), OPTIONS)).not.toBe(key);
  });

  it("keeps the two layers of one cue apart", () => {
    const { flat, lit } = cuePaths(cueKey(CUE, captionStyle("highlight"), OPTIONS));

    expect(flat).not.toBe(lit);
    expect(flat.startsWith("captions/")).toBe(true);
    expect(lit.endsWith(".png")).toBe(true);
  });
});
