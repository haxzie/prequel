import { describe, expect, it } from "vitest";

import { placement, type Rect, type Size } from "../../../shared/layout";
import { DEFAULT_SETTINGS, type LayoutSettings } from "../../../shared/project";
import { boxPatch, clampCrop, cropPatch, flipCrop } from "./boxes";

const FRAME: Size = { width: 1920, height: 1080 };
const SOURCE: Size = { width: 2560, height: 1440 };

const layoutWith = (patch: Partial<LayoutSettings>): LayoutSettings => ({
  ...DEFAULT_SETTINGS.layout,
  ...patch,
});

/** Where the screen actually lands, through the same arithmetic the plan uses. */
const placed = (layout: LayoutSettings, which: "screen" | "camera" = "screen") =>
  placement(FRAME, layout, DEFAULT_SETTINGS.background, { screen: SOURCE, camera: SOURCE }, which);

describe("boxPatch", () => {
  it("makes the arrangement custom when the screen is moved", () => {
    const { section, patch } = boxPatch(
      "screen",
      false,
      { x: 100, y: 100, width: 960, height: 540 },
      FRAME,
      layoutWith({ preset: "over-padded" }),
      { screen: { x: 0, y: 0, width: 1920, height: 1080 }, camera: null },
    );

    expect(section).toBe("layout");
    expect(patch.preset).toBe("custom");
    // Seeded from where the pictures were, so neither jumps.
    expect(patch.screenX).toBeCloseTo((100 + 480) / 1920);
  });

  it("leaves the arrangement alone when a free camera is moved", () => {
    const { patch } = boxPatch(
      "camera",
      false,
      { x: 0, y: 0, width: 200, height: 200 },
      FRAME,
      layoutWith({ preset: "over-full" }),
      { screen: null, camera: null },
    );

    expect(patch.preset).toBeUndefined();
    expect(patch.cameraWidth).toBeUndefined();
  });

  it("detaches a placed camera to custom when it is resized", () => {
    const { patch } = boxPatch(
      "camera",
      true,
      { x: 0, y: 0, width: 200, height: 200 },
      FRAME,
      layoutWith({ preset: "split" }),
      { screen: null, camera: null },
    );

    expect(patch.preset).toBe("custom");
    expect(patch.cameraVisible).toBe(true);
  });
});

describe("cropPatch", () => {
  /**
   * The property the whole crop tool rests on: what was drawn on the source is
   * what the plan then samples. Asserted through `placement` rather than
   * against the leaves, because the leaves are only right if `place` reads them
   * back the way this wrote them — which is the half that cannot be eyeballed.
   */
  const roundTrips = (crop: Rect, layout: LayoutSettings, which: "screen" | "camera") => {
    const before = placed(layout, which);
    expect(before).not.toBeNull();

    const { patch } = cropPatch(which, crop, SOURCE, before!.dstRect, FRAME, layout, {
      screen: before!.dstRect,
      camera: { ...before!.dstRect, card: false },
    });
    const after = placed(layoutWith({ ...layout, ...patch }), which);

    expect(after).not.toBeNull();
    // Within a pixel and a half, which is `fitInside` flooring the box to whole
    // output pixels and the crop level dividing by it. A source pixel and a
    // half of a 2560-wide take is not something anybody can see, and demanding
    // the bit would be a test of the rounding rather than of the mapping.
    for (const edge of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(after!.srcRect[edge] - crop[edge])).toBeLessThan(1.5);
    }
  };

  it("shows exactly the region it was given, off centre", () => {
    roundTrips(
      { x: 400, y: 200, width: 800, height: 600 },
      layoutWith({ preset: "custom" }),
      "screen",
    );
  });

  it("shows exactly the region it was given, out of a padded arrangement", () => {
    roundTrips(
      { x: 0, y: 0, width: 1280, height: 1080 },
      layoutWith({ preset: "over-padded" }),
      "screen",
    );
  });

  it("shows exactly the region it was given, on the camera", () => {
    roundTrips(
      { x: 1200, y: 100, width: 640, height: 640 },
      layoutWith({ preset: "over-full" }),
      "camera",
    );
  });

  it("gives the box the region's proportions without growing it", () => {
    const layout = layoutWith({ preset: "custom" });
    const before = placed(layout)!;
    const { patch } = cropPatch(
      "screen",
      { x: 0, y: 0, width: 600, height: 1200 },
      SOURCE,
      before.dstRect,
      FRAME,
      layout,
      { screen: before.dstRect, camera: null },
    );
    const after = placed(layoutWith({ ...layout, ...patch }))!;

    expect(after.dstRect.width / after.dstRect.height).toBeCloseTo(0.5, 2);
    expect(after.dstRect.width).toBeLessThanOrEqual(before.dstRect.width + 1);
    expect(after.dstRect.height).toBeLessThanOrEqual(before.dstRect.height + 1);
  });

  it("leaves the whole picture on show when the crop is the whole picture", () => {
    roundTrips({ x: 0, y: 0, ...SOURCE }, layoutWith({ preset: "custom" }), "screen");
  });
});

describe("flipCrop", () => {
  it("reflects a region across the middle of the source", () => {
    expect(flipCrop({ x: 100, y: 50, width: 400, height: 300 }, SOURCE)).toEqual({
      x: 2560 - 100 - 400,
      y: 50,
      width: 400,
      height: 300,
    });
  });

  it("is its own inverse, which is what lets one function serve both ways", () => {
    const crop = { x: 713, y: 211, width: 404, height: 309 };

    expect(flipCrop(flipCrop(crop, SOURCE), SOURCE)).toEqual(crop);
  });

  /**
   * The bug this exists for: the compositor mirrors the camera by flipping the
   * quad's own uv, so the window stays in the file's coordinates and what is
   * drawn is that window the other way round. A rectangle dragged on the
   * mirrored picture therefore has to come back reflected, or the crop lands on
   * the other side of the person's head.
   */
  it("puts a crop drawn on the mirrored picture back where it was drawn", () => {
    const layout = layoutWith({ preset: "over-full", cameraMirror: true });
    const before = placed(layout, "camera")!;
    // Hard against the left of what is on screen, which is the right of the
    // file — the half the bug got wrong.
    const drawn = { x: 0, y: 200, width: 500, height: 500 };

    const { patch } = cropPatch(
      "camera",
      flipCrop(drawn, SOURCE),
      SOURCE,
      before.dstRect,
      FRAME,
      layout,
      { screen: null, camera: { ...before.dstRect, card: false } },
    );
    const after = placed(layoutWith({ ...layout, ...patch }), "camera")!;

    const shown = flipCrop(after.srcRect, SOURCE);
    for (const edge of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(shown[edge] - drawn[edge])).toBeLessThan(1.5);
    }
  });
});

describe("clampCrop", () => {
  it("pulls a rectangle dragged off the edge back inside", () => {
    expect(clampCrop({ x: -50, y: -50, width: 400, height: 400 }, SOURCE)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
  });

  it("never returns a rectangle larger than the source", () => {
    expect(clampCrop({ x: 0, y: 0, width: 9000, height: 9000 }, SOURCE)).toEqual({
      x: 0,
      y: 0,
      width: 2560,
      height: 1440,
    });
  });

  it("keeps a rectangle dragged to nothing grabbable", () => {
    const tiny = clampCrop({ x: 10, y: 10, width: 0, height: 0 }, SOURCE);

    expect(tiny.width).toBeGreaterThan(0);
    expect(tiny.height).toBeGreaterThan(0);
  });
});
