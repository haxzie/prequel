/**
 * What picking a camera shape writes.
 *
 * The valuable half is what it *leaves alone*. Three leaves hold the one
 * answer — the shape, the cutout and the frame — and each keeps its value
 * under the other two, which is what lets taking a frame off put back the
 * shape and the roundness that were chosen before it went on. A patch that
 * wrote all three every time would look identical on screen and quietly empty
 * that drawer.
 */
import { describe, expect, it } from "vitest";

import { CAMERA_FRAMES } from "../../../shared/camera-frames";
import { DEFAULT_SETTINGS, SHAPE_RADIUS, type LayoutSettings } from "../../../shared/project";
import { CAMERA_SHAPES, cameraShapeChoice, cameraShapePatch } from "./cameraShape";

const LAYOUT = (over: Partial<LayoutSettings> = {}): LayoutSettings => ({
  ...DEFAULT_SETTINGS.layout,
  ...over,
});

/** A 16:9 camera, which is what `wide` and `portrait` take their width from. */
const SOURCE = { width: 1280, height: 720 };

describe("picking a camera shape", () => {
  it("offers every shape, every frame and the two that replace the edge", () => {
    const values = CAMERA_SHAPES.map((option) => option.value);

    expect(values).toContain("cutout");
    expect(values).toContain("blob");
    for (const id of Object.keys(CAMERA_FRAMES)) expect(values).toContain(id);
    // Every row has a line under it, which is most of why the list is a list.
    for (const option of CAMERA_SHAPES) expect(option.note.length).toBeGreaterThan(0);
  });

  it("writes the proportions and the roundness a plain shape stands for", () => {
    const patch = cameraShapePatch("circle", LAYOUT(), SOURCE);

    expect(patch.cameraShape).toBe("circle");
    expect(patch.cameraCornerRadius).toBe(SHAPE_RADIUS.circle);
    expect(patch.cameraWidth).toBeCloseTo(DEFAULT_SETTINGS.layout.cameraHeight, 6);
  });

  it("writes a frame's own proportions and leaves the roundness alone", () => {
    // The hole in the art is the shape while a frame is on, so the stored
    // radius is the thing that has to survive untouched — it is what None puts
    // back.
    const patch = cameraShapePatch("crt", LAYOUT({ cameraCornerRadius: 0.37 }), SOURCE);

    expect(patch.cameraFrame).toBe("crt");
    expect(patch.cameraWidth).toBeCloseTo(
      DEFAULT_SETTINGS.layout.cameraHeight * CAMERA_FRAMES.crt.aspect,
      6,
    );
    expect("cameraCornerRadius" in patch).toBe(false);
    expect("cameraShape" in patch).toBe(false);
  });

  it("takes a frame off when a plain shape is picked, and not otherwise", () => {
    // Written every time, a `"none"` would land in a clip's overrides on any
    // shape change and mark the frame as set for that clip when nobody set it.
    expect(cameraShapePatch("circle", LAYOUT({ cameraFrame: "stamp" }), SOURCE).cameraFrame).toBe(
      "none",
    );
    expect("cameraFrame" in cameraShapePatch("circle", LAYOUT(), SOURCE)).toBe(false);
  });

  it("takes a cutout off the same way", () => {
    expect(cameraShapePatch("circle", LAYOUT({ cameraCutout: true }), SOURCE).cameraCutout).toBe(
      false,
    );
    expect("cameraCutout" in cameraShapePatch("circle", LAYOUT(), SOURCE)).toBe(false);
  });

  it("leaves the size, the zoom and the framing alone for a cutout", () => {
    // The cutout is the same picture with its background gone, not a new one.
    expect(cameraShapePatch("cutout", LAYOUT({ cameraFrame: "stamp" }), SOURCE)).toEqual({
      cameraCutout: true,
    });
  });

  it("lights the row the settings actually describe", () => {
    // The three leaves can all hold a value at once — the shape stays "blob"
    // under a plate — so which row is lit is an order, not a lookup.
    expect(cameraShapeChoice(LAYOUT({ cameraShape: "wide" }))).toBe("wide");
    expect(cameraShapeChoice(LAYOUT({ cameraShape: "blob", cameraFrame: "crt" }))).toBe("crt");
    expect(
      cameraShapeChoice(LAYOUT({ cameraShape: "blob", cameraFrame: "crt", cameraCutout: true })),
    ).toBe("cutout");
  });
});
