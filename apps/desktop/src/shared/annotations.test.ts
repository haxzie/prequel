/**
 * What a mark is, and where it is.
 *
 * Three properties, and all three fail quietly if they break. A hit test that
 * uses the bounding box makes an arrow drawn corner to corner swallow every
 * click in the picture; a coordinate that is not a fraction of the frame moves
 * every mark when a screenshot is reframed; and a stored mark with one point or
 * a `NaN` in it throws inside the painter, which takes the whole layer — and
 * with it the export — down.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_COLOUR,
  DEFAULT_WIDTH,
  annotationHit,
  annotationRect,
  newAnnotation,
  sanitiseAnnotations,
  strokeWidth,
  type Annotation,
} from "./annotations.js";

const FRAME = { width: 1920, height: 1080 };
const PORTRAIT = { width: 1080, height: 1920 };

/** An arrow across the middle of the frame, corner to corner. */
function arrow(): Annotation {
  return newAnnotation("a", "arrow", [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.9 },
  ]);
}

describe("where a mark is", () => {
  it("is hit on its line, not anywhere in its box", () => {
    const mark = arrow();

    // On the diagonal, halfway along.
    expect(annotationHit(FRAME, mark, { x: 0.5 * 1920, y: 0.5 * 1080 }, 4)).toBe(true);

    // Inside the same bounding box and nowhere near the line. This is the one
    // that matters: an arrow is usually the biggest thing in a screenshot by
    // bounding box, and a box test would make it the answer to every click.
    expect(annotationHit(FRAME, mark, { x: 0.85 * 1920, y: 0.15 * 1080 }, 4)).toBe(false);
  });

  it("does not reach past the end of a short line", () => {
    const mark = newAnnotation("a", "line", [
      { x: 0.2, y: 0.5 },
      { x: 0.3, y: 0.5 },
    ]);

    // Along the same infinite line, well past where the mark stops. Measured
    // against the segment rather than the line, so this is a miss.
    expect(annotationHit(FRAME, mark, { x: 0.8 * 1920, y: 0.5 * 1080 }, 4)).toBe(false);
  });

  it("gives a box its outline and not its middle", () => {
    const mark = newAnnotation("a", "rect", [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ]);

    expect(annotationHit(FRAME, mark, { x: 0.2 * 1920, y: 0.5 * 1080 }, 4)).toBe(true);
    // A box is usually drawn *so that* what is inside it can be seen, and a
    // mark that ate those clicks would sit in front of everything it frames.
    expect(annotationHit(FRAME, mark, { x: 0.5 * 1920, y: 0.5 * 1080 }, 4)).toBe(false);
  });

  it("gives the highlighter its whole band", () => {
    const mark = newAnnotation("a", "highlight", [
      { x: 0.2, y: 0.4 },
      { x: 0.8, y: 0.5 },
    ]);

    // Filled, unlike the box: a band over a line of text has to be grabbable
    // along its length, and its middle is where the text is.
    expect(annotationHit(FRAME, mark, { x: 0.5 * 1920, y: 0.45 * 1080 }, 4)).toBe(true);
  });

  it("grows its box by the stroke, so a thick mark is clickable at its edge", () => {
    const thin = { ...arrow(), width: 0.002 };
    const thick = { ...arrow(), width: 0.02 };

    // A stroke straddles its path, so half of a thick one lies outside the
    // points. Measured from the points alone, clicking the visible edge of a
    // heavy arrow would select nothing.
    expect(annotationRect(FRAME, thick).width).toBeGreaterThan(annotationRect(FRAME, thin).width);
  });
});

describe("a mark through a reframe", () => {
  it("keeps its place when the frame is reshaped", () => {
    const mark = newAnnotation("a", "rect", [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.75 },
    ]);

    // Fractions of each edge, like `watermarkX` — so a mark on the middle of
    // the picture is on the middle of the picture in either orientation. A
    // single fraction used for both would slide everything towards a corner.
    const landscape = annotationRect(FRAME, mark);
    const portrait = annotationRect(PORTRAIT, mark);

    // The centre, not the corner. The box is grown by half the stroke, which is
    // measured against the *shorter* edge — so the padding is a different
    // fraction of the width in each orientation, which is right and is not what
    // this is about. A centre is padded symmetrically either way.
    expect((landscape.x + landscape.width / 2) / FRAME.width).toBeCloseTo(0.5, 3);
    expect((landscape.y + landscape.height / 2) / FRAME.height).toBeCloseTo(0.5, 3);
    expect((portrait.x + portrait.width / 2) / PORTRAIT.width).toBeCloseTo(0.5, 3);
    expect((portrait.y + portrait.height / 2) / PORTRAIT.height).toBeCloseTo(0.5, 3);
  });

  it("keeps its weight when the frame is reshaped", () => {
    const mark = arrow();

    // The shorter edge, unlike the positions: a thickness is one number and has
    // to mean the same amount of ink either way round. Both frames here have
    // the same shorter edge.
    expect(strokeWidth(FRAME, mark)).toBeCloseTo(strokeWidth(PORTRAIT, mark), 6);
  });
});

describe("marks read back off disk", () => {
  it("drops a mark with nothing to draw", () => {
    const stored = [
      { id: "a", kind: "arrow", points: [{ x: 0.5, y: 0.5 }], color: "#fff", width: 0.004 },
      { id: "b", kind: "pen", points: [], color: "#fff", width: 0.004 },
    ];

    // One point is not a mark, and both would reach the painter as a path with
    // nothing in it.
    expect(sanitiseAnnotations(stored)).toEqual([]);
  });

  it("drops a coordinate that is not a number", () => {
    const stored = [
      {
        id: "a",
        kind: "line",
        points: [
          { x: 0.1, y: 0.1 },
          { x: Number.NaN, y: 0.9 },
        ],
        color: "#fff",
        width: 0.004,
      },
    ];

    // The surviving point is one, which is not a mark. A `NaN` reaching the
    // canvas throws inside `roundRect` and takes the layer with it.
    expect(sanitiseAnnotations(stored)).toEqual([]);
  });

  it("drops a kind this build does not know", () => {
    expect(
      sanitiseAnnotations([
        {
          id: "a",
          kind: "redaction",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("fills in a style the file does not carry", () => {
    const [mark] = sanitiseAnnotations([
      {
        id: "a",
        kind: "arrow",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ]);

    expect(mark?.color).toBe(DEFAULT_COLOUR);
    expect(mark?.width).toBe(DEFAULT_WIDTH);
    expect(mark?.opacity).toBe(1);
  });

  it("holds a thickness to something drawable", () => {
    const [mark] = sanitiseAnnotations([
      {
        id: "a",
        kind: "arrow",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        width: 40,
      },
    ]);

    // Forty times the shorter edge is a mark that covers the picture, which is
    // a file nobody can do anything with rather than an edit.
    expect(mark?.width).toBeLessThanOrEqual(0.2);
  });

  it("reads nothing out of nothing", () => {
    // Every project saved before marks existed, which is all of them.
    expect(sanitiseAnnotations(undefined)).toEqual([]);
    expect(sanitiseAnnotations(null)).toEqual([]);
    expect(sanitiseAnnotations("marks")).toEqual([]);
  });
});

describe("a fresh mark", () => {
  it("gives the highlighter its own ink rather than the arrow's", () => {
    const highlighter = newAnnotation("a", "highlight", [
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
    ]);

    // A yellow band and a red hairline are not one tool with a setting
    // changed: offering the last-used red here is a translucent red box nobody
    // asked for.
    expect(highlighter.opacity).toBeLessThan(1);
    expect(highlighter.width).toBeGreaterThan(DEFAULT_WIDTH);
    expect(highlighter.color).not.toBe(DEFAULT_COLOUR);
  });

  it("takes the ink it was handed for everything else", () => {
    const mark = newAnnotation(
      "a",
      "arrow",
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      { color: "#3b82f6", width: 0.008 },
    );

    expect(mark.color).toBe("#3b82f6");
    expect(mark.width).toBe(0.008);
    expect(mark.opacity).toBe(1);
  });
});
