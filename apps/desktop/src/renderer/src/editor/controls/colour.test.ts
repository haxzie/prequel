import { describe, expect, it } from "vitest";

import { hexToHsv, hsvToHex } from "./colour";

describe("hexToHsv", () => {
  it("reads the primaries at their own corners of the wheel", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00")).toEqual({ h: 120, s: 1, v: 1 });
    expect(hexToHsv("#0000ff")).toEqual({ h: 240, s: 1, v: 1 });
  });

  it("reports no hue for a grey, rather than inventing red", () => {
    expect(hexToHsv("#808080")).toEqual({ h: 0, s: 0, v: 128 / 255 });
    expect(hexToHsv("#ffffff")).toEqual({ h: 0, s: 0, v: 1 });
  });

  it("takes a colour with or without its hash, in either case", () => {
    expect(hexToHsv("#FF8800")).toEqual(hexToHsv("ff8800"));
  });

  it("answers black for anything it cannot read", () => {
    for (const bad of ["", "#fff", "rgb(1,2,3)", "#gggggg"]) {
      expect(hexToHsv(bad)).toEqual({ h: 0, s: 0, v: 0 });
    }
  });
});

describe("hsvToHex", () => {
  // Within half a degree rather than exactly. A hue leaves as three bytes and
  // comes back divided by 255, so the trip quantises — 15° returns as 15.06°.
  // Tightening this would be asserting that 24-bit colour is lossless.
  it("round-trips every hue at full saturation", () => {
    for (let h = 0; h < 360; h += 15) {
      expect(hexToHsv(hsvToHex({ h, s: 1, v: 1 })).h).toBeCloseTo(h, 0);
    }
  });

  it("round-trips the colours the editor ships with", () => {
    for (const hex of ["#4296fc", "#ff4d5e", "#1668c9", "#dcb43c", "#16171a"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("clamps rather than emitting a string that is not a colour", () => {
    expect(hsvToHex({ h: 400, s: 2, v: 2 })).toMatch(/^#[0-9a-f]{6}$/);
    expect(hsvToHex({ h: -30, s: -1, v: -1 })).toBe("#000000");
  });
});
