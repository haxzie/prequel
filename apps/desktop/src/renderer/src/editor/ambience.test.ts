/**
 * Which colours the board is lit with.
 *
 * The failure here is not a crash, it is a wash of the wrong colour — or, far
 * more often, of no colour at all. Three properties carry it: the glow is the
 * colour somebody would *name* if asked what the picture is, which is not the
 * colour that covers the most pixels; three picks are three different colours
 * rather than three shades of one; and a picture with no colour in it produces
 * no glow rather than a grey smear.
 */
import { describe, expect, it } from "vitest";

import { ambientColours, ambientGradient, dominant, parseHex, type Rgb } from "./ambience";

/** A block of RGBA pixels from a list of colours and how many of each. */
function pixels(...runs: [Rgb, number][]): Uint8ClampedArray {
  const total = runs.reduce((sum, [, count]) => sum + count, 0);
  const data = new Uint8ClampedArray(total * 4);

  let at = 0;
  for (const [colour, count] of runs) {
    for (let index = 0; index < count; index += 1) {
      data[at] = colour.r;
      data[at + 1] = colour.g;
      data[at + 2] = colour.b;
      data[at + 3] = 255;
      at += 4;
    }
  }

  return data;
}

const RED: Rgb = { r: 210, g: 40, b: 40 };
const BLUE: Rgb = { r: 40, g: 70, b: 210 };
const GREEN: Rgb = { r: 40, g: 180, b: 90 };
const GREY: Rgb = { r: 120, g: 122, b: 124 };

/** Near enough: the buckets average, so a pick is within a step of its input. */
function near(colour: Rgb | undefined, wanted: Rgb) {
  expect(colour).toBeDefined();
  expect(Math.abs(colour!.r - wanted.r)).toBeLessThan(12);
  expect(Math.abs(colour!.g - wanted.g)).toBeLessThan(12);
  expect(Math.abs(colour!.b - wanted.b)).toBeLessThan(12);
}

describe("picking the colours", () => {
  it("takes the colour of the picture over the colour of most of it", () => {
    // Four-fifths flat grey with a red fifth, which is most wallpapers: a lot
    // of sky, or a lot of vignette, and one thing you would actually name.
    // Counted straight, the answer is grey and the board is lit with nothing.
    const picked = dominant(pixels([GREY, 400], [RED, 100]), 1);

    near(picked[0], RED);
  });

  it("answers with different colours, not shades of one", () => {
    const almost: Rgb = { r: 214, g: 46, b: 44 };
    const picked = dominant(pixels([RED, 300], [almost, 280], [BLUE, 200]), 2);

    expect(picked).toHaveLength(2);
    near(picked[0], RED);
    // Not `almost`, which is the same red and would be the same lamp drawn
    // twice.
    near(picked[1], BLUE);
  });

  it("finds three when there are three", () => {
    const picked = dominant(pixels([RED, 300], [BLUE, 200], [GREEN, 100]), 3);

    expect(picked).toHaveLength(3);
    near(picked[0], RED);
  });

  it("lights nothing from a picture with no colour in it", () => {
    // Black, white and grey. Blurred, every one of them is the board itself.
    const picked = dominant(
      pixels([{ r: 4, g: 4, b: 4 }, 200], [{ r: 252, g: 252, b: 252 }, 200], [GREY, 1]),
      3,
    );

    // Nothing at all, so `ambientGradient` draws no glow. A grey wash behind
    // the composition is not a mistake anybody can point at — it just makes
    // the board look dirty.
    expect(picked).toEqual([]);
  });

  it("ignores what is transparent", () => {
    const data = pixels([RED, 2], [BLUE, 2]);
    // The two blues knocked out. A background with an alpha channel would
    // otherwise vote for whatever is behind nothing.
    data[11] = 0;
    data[15] = 0;

    expect(dominant(data, 2)).toHaveLength(1);
  });
});

describe("where the colours come from", () => {
  it("reads a solid straight off the setting", () => {
    const colours = ambientColours({ kind: "solid", color: "#d22828" }, new Map());

    expect(colours).toEqual([{ r: 210, g: 40, b: 40 }]);
  });

  it("reads both stops of a gradient, in the order the ramp runs", () => {
    const colours = ambientColours(
      { kind: "gradient", from: "#5433ff", to: "#20bdff", angle: 135 },
      new Map(),
    );

    expect(colours).toEqual([
      { r: 84, g: 51, b: 255 },
      { r: 32, g: 189, b: 255 },
    ]);
  });

  it("has nothing to say about a picture that has not loaded", () => {
    // The project names the file the moment it is chosen and `useImages` fills
    // it in a moment later. Until then the board is simply not lit.
    const colours = ambientColours(
      { kind: "image", source: "preset", path: "monterey.jpg" },
      new Map(),
    );

    expect(colours).toEqual([]);
  });
});

describe("the glow", () => {
  it("is nothing at all when there are no colours", () => {
    // Not a transparent gradient, which would still be an element, a layer and
    // a composite. There is no glow, so there is no glow.
    expect(ambientGradient([])).toBeNull();
  });

  it("lights all three lamps from a single colour", () => {
    const css = ambientGradient([RED]);

    // A solid background has one colour, and one lamp in a corner would light
    // the board unevenly for no reason anybody could name.
    expect(css?.match(/radial-gradient/g)).toHaveLength(3);
  });

  it("keeps the hue it was given, and turns it up into light", () => {
    // `RED` is already at the target, so it is passed through untouched.
    expect(ambientGradient([RED], 0.5)).toContain("210 40 40");

    // A dark colour is scaled until its brightest channel reaches the target,
    // with the ratios between the channels intact — the hue of the picture,
    // at the brightness of a lamp. Unlifted, this is invisible on the board.
    const dark = ambientGradient([{ r: 22, g: 4, b: 60 }], 0.5);
    expect(dark).toContain("77 14 210");
  });
});

describe("parsing a stored colour", () => {
  it("takes both lengths", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#20bdff")).toEqual({ r: 32, g: 189, b: 255 });
    expect(parseHex("20bdff")).toEqual({ r: 32, g: 189, b: 255 });
  });

  it("refuses anything else rather than guessing", () => {
    // Only a hand-edited `project.json` gets here, and a mis-parsed colour is a
    // wash of the wrong one with nothing on screen to explain it.
    expect(parseHex("rgb(1,2,3)")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("")).toBeNull();
  });
});
