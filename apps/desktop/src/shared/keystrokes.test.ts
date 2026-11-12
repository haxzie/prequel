/**
 * The shape of a chord's row.
 *
 * The valuable thing here is that two files agree: `keyBitmap.ts` draws the
 * row and `layout.ts` places what it drew, and both measure it with these
 * functions. A row drawn to one set of numbers and placed to another is a row
 * of caps stretched or squashed, which looks like a font problem and is not.
 */
import { describe, expect, it } from "vitest";

import {
  capWidth,
  chordExtent,
  KEY_BLEED,
  KEY_GAP,
  KEY_PLATE_IDS,
  KEY_SIZE_MAX,
  KEY_SIZE_MIN,
  keyLooks,
  keyPlate,
  keySizeLeaf,
  keySizeSlider,
  keyStyleId,
} from "./keystrokes";

const CAP = 100;

describe("laying a chord out", () => {
  it("makes a single-glyph cap square", () => {
    // Every modifier and every letter, which is nearly every cap there is.
    expect(capWidth("⌘", CAP)).toBe(CAP);
    expect(capWidth("K", CAP)).toBe(CAP);
  });

  it("widens the handful of caps that are a word", () => {
    // `Space` and the function keys. A square cap would clip them.
    expect(capWidth("Space", CAP)).toBeGreaterThan(CAP);
    expect(capWidth("F12", CAP)).toBeGreaterThan(CAP);
    expect(capWidth("F12", CAP)).toBeLessThan(capWidth("Space", CAP));
  });

  it("measures the row as its caps, its gaps and its bleed", () => {
    // Written out rather than compared against `chordExtent` itself, so this
    // says what the row *is* instead of restating the implementation.
    const keys = ["⌘", "⇧", "P"];
    const extent = chordExtent(keys, CAP);

    expect(extent.width).toBeCloseTo(CAP * 3 + KEY_GAP * CAP * 2 + KEY_BLEED * CAP * 2, 6);
    expect(extent.height).toBeCloseTo(CAP * (1 + KEY_BLEED * 2), 6);
  });

  it("keeps room round the row for what is drawn outside the caps", () => {
    // The shadow reaches furthest, and a bitmap cut to the caps would shave
    // it — the same reason a text unit's cell is padded.
    expect(chordExtent(["⌘"], CAP).height).toBeGreaterThan(CAP);
  });

  it("grows with the cap and nothing else", () => {
    // The slider moves the cap height, and everything in a row is a multiple
    // of it — so doubling the cap doubles the row exactly.
    const small = chordExtent(["⌘", "C"], 50);
    const large = chordExtent(["⌘", "C"], 100);

    expect(large.width / small.width).toBeCloseTo(2, 6);
    expect(large.height / small.height).toBeCloseTo(2, 6);
  });

  it("falls back rather than throwing on a plate it has never heard of", () => {
    // A project written by a build with plates this one does not ship still
    // opens, and opens drawing something.
    for (const id of KEY_PLATE_IDS) expect(keyPlate(id)).toBe(id);
    expect(keyPlate("hologram")).toBe("keys");
  });
});

describe("which looks a project asks for", () => {
  const LOOK = {
    keysVisible: false,
    keysPlate: "keys",
    keysColor: "#ffffff",
    keysOpacity: 0.62,
  };

  it("finds the one a clip switches on while the defaults are off", () => {
    // The bug this is here for, and the way the feature first shipped: the row
    // is a per-clip setting, and the way anybody turns it on is to select a
    // clip and switch it there. Reading only the defaults drew nothing at all
    // — a panel of controls over a video with no shortcuts on it.
    const looks = keyLooks([LOOK, { ...LOOK, keysVisible: true, keysPlate: "plain" }]);

    expect(looks.size).toBe(1);
    expect([...looks.values()][0]!.keysPlate).toBe("plain");
  });

  it("asks for nothing where nothing switches it on", () => {
    expect(keyLooks([LOOK, LOOK]).size).toBe(0);
  });

  it("shares one look between clips that style it alike", () => {
    // A clip that switches the row on and styles nothing is asking for the
    // defaults' look. Drawing it twice would be two sets of identical bitmaps
    // and two overlays stacked in the same place.
    const on = { ...LOOK, keysVisible: true };

    expect(keyLooks([on, on, on]).size).toBe(1);
  });

  it("keeps two looks apart where two clips really differ", () => {
    const on = { ...LOOK, keysVisible: true };

    expect(keyLooks([on, { ...on, keysColor: "#ffcc00" }]).size).toBe(2);
    expect(keyLooks([on, { ...on, keysPlate: "bar" }]).size).toBe(2);
    expect(keyLooks([on, { ...on, keysOpacity: 0.3 }]).size).toBe(2);
  });

  it("ignores what only moves pixels", () => {
    // The size and the position place a bitmap rather than redrawing it: a
    // size slider that renamed every chord on the way past would rewrite the
    // whole set sixty times a second.
    const on = { ...LOOK, keysVisible: true };

    expect(keyStyleId(on)).toBe(
      keyStyleId({ ...on, keysSize: 0.09, keysPosition: "top" } as never),
    );
  });
});

describe("the size the slider shows", () => {
  it("spends its whole travel on sizes worth drawing", () => {
    // The leaf is a fraction of the frame's shorter edge and the useful band
    // is two to twelve per cent of it, so a slider showing the leaf reads 5%
    // and wastes nine tenths of itself. Ends at the ends, which is the whole
    // point of the conversion.
    expect(keySizeSlider(KEY_SIZE_MIN)).toBe(0);
    expect(keySizeSlider(KEY_SIZE_MAX)).toBe(1);
  });

  it("round-trips, so a drag writes back what it showed", () => {
    // Two directions that disagree is a slider that walks as it is dragged.
    for (const at of [0, 0.25, 0.5, 0.75, 1]) {
      expect(keySizeSlider(keySizeLeaf(at))).toBeCloseTo(at, 10);
    }
  });

  it("never writes a cap of no height", () => {
    // Nought on the control is the smallest size worth drawing, not nothing:
    // a row that vanished at the bottom of the slider would be a second way
    // to switch the feature off, beside the one that says so.
    expect(keySizeLeaf(0)).toBeGreaterThan(0);
  });
});
