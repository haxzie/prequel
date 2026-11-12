/**
 * The frame catalogue.
 *
 * The table itself, not the artwork. What is here is the shape of the table:
 * an entry a picker can render, a picture that ships, numbers the geometry can
 * hang a plate from, and the two answers that mean "draw nothing".
 *
 * The numbers themselves are measured by `scripts/make-frames.mjs` off the art
 * it cuts. Nothing here can check them against the pixels — what it can check
 * is that they describe a hole inside a picture with a border all the way
 * round it, which is what every piece of arithmetic downstream assumes.
 */
import { describe, expect, it } from "vitest";

import {
  CAMERA_FRAMES,
  CAMERA_FRAME_FILES,
  CAMERA_FRAME_IDS,
  cameraFrame,
  type CameraFrameId,
} from "./camera-frames";

describe("the frames the camera can be dressed in", () => {
  it("gives every frame something a picker can show", () => {
    for (const id of CAMERA_FRAME_IDS) {
      expect(CAMERA_FRAMES[id].label.length, id).toBeGreaterThan(0);
      expect(CAMERA_FRAMES[id].hint.length, id).toBeGreaterThan(0);
    }
  });

  it("names a picture that ships with the app", () => {
    // The file on the shelf, which is also the file in `resources/frames`.
    // A name here with no picture behind it is a frame that can be chosen and
    // draws nothing, with nothing in the editor to say why.
    for (const id of CAMERA_FRAME_IDS) {
      expect(CAMERA_FRAMES[id].file, id).toMatch(/^[a-z][a-z0-9-]*\.png$/);
    }
    expect(new Set(CAMERA_FRAME_FILES).size).toBe(CAMERA_FRAME_IDS.length);
  });

  it("keeps every hole inside the picture it is in", () => {
    // Fractions of the artwork, measured off its alpha by
    // `scripts/make-frames.mjs`. A hole that ran off the edge of its own
    // picture would put the plate somewhere the arithmetic cannot place it.
    for (const id of CAMERA_FRAME_IDS) {
      const { aperture } = CAMERA_FRAMES[id];
      expect(aperture.x, `${id} x`).toBeGreaterThan(0);
      expect(aperture.y, `${id} y`).toBeGreaterThan(0);
      expect(aperture.width, `${id} width`).toBeGreaterThan(0);
      expect(aperture.height, `${id} height`).toBeGreaterThan(0);
      expect(aperture.x + aperture.width, `${id} right`).toBeLessThan(1);
      expect(aperture.y + aperture.height, `${id} bottom`).toBeLessThan(1);
    }
  });

  it("leaves room for a plate on every side", () => {
    // A margin of nothing is a frame with no frame in it. The narrowest here
    // is the window's side, and `frameOverlap` in `layout.ts` reaches the
    // picture in under the paper by a tenth of that — so this is also what
    // keeps that overlap landing on plate rather than on fresh air.
    for (const id of CAMERA_FRAME_IDS) {
      const { aperture } = CAMERA_FRAMES[id];
      for (const [side, margin] of [
        ["left", aperture.x],
        ["top", aperture.y],
        ["right", 1 - aperture.x - aperture.width],
        ["bottom", 1 - aperture.y - aperture.height],
      ] as const) {
        expect(margin, `${id}'s ${side} margin`).toBeGreaterThan(0.02);
      }
    }
  });

  it("knows what shape each hole is", () => {
    // Written onto `cameraWidth` when a frame is picked, so it has to be the
    // hole's own proportions and not a guess: a number that disagrees with the
    // art is a plate stretched the moment it is chosen.
    for (const id of CAMERA_FRAME_IDS) {
      expect(CAMERA_FRAMES[id].aspect, id).toBeGreaterThan(0.2);
      expect(CAMERA_FRAMES[id].aspect, id).toBeLessThan(5);
    }
  });

  it("keeps the shadow's stand-in corner inside the plate", () => {
    // Half is the degenerate rounded rectangle that is a circle; past it the
    // corners overlap and the shape folds through itself.
    for (const id of CAMERA_FRAME_IDS) {
      const { plate } = CAMERA_FRAMES[id];
      expect(plate.radius, `${id}'s plate`).toBeGreaterThanOrEqual(0);
      expect(plate.radius, `${id}'s plate`).toBeLessThanOrEqual(0.5);
      expect(plate.exponent, `${id}'s plate`).toBeGreaterThanOrEqual(2);
    }
  });

  it("resolves a name, and nothing else", () => {
    expect(cameraFrame("polaroid")).toBe(CAMERA_FRAMES.polaroid);
    // The two ways of meaning no plate, which answer alike on purpose: none
    // was chosen, and a frame written by a newer build that this one does not
    // ship. Drawing nothing beats refusing to open the project.
    expect(cameraFrame("none" satisfies CameraFrameId)).toBeNull();
    expect(cameraFrame("lightbox")).toBeNull();
    // Nothing off the prototype chain, which `Object.hasOwn` is what guards.
    expect(cameraFrame("toString")).toBeNull();
  });
});
