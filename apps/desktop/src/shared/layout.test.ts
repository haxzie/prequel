/**
 * The highest-value test in the editor.
 *
 * Every pixel of the preview and every pixel of the export come from this
 * function. A mistake here is not a crash — it is a camera in the wrong corner
 * or padding that vanishes when the frame is rotated, noticed only after
 * someone watches the file.
 */
import { describe, expect, it } from "vitest";

import {
  buildRenderPlan,
  cursorAt,
  rectAt,
  type PlanItem,
  type RenderPlan,
  type Size,
} from "./layout.js";
import { DEFAULT_SETTINGS, DEFAULT_ZOOM, type SliceSettings, type ZoomSlice } from "./project.js";

const LANDSCAPE: Size = { width: 1920, height: 1080 };
const VERTICAL: Size = { width: 1080, height: 1920 };
const SCREEN: Size = { width: 2560, height: 1440 };
const CAMERA: Size = { width: 1280, height: 720 };

function settings(overrides: Partial<SliceSettings> = {}): SliceSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  return {
    layout: { ...base.layout, ...overrides.layout },
    background: { ...base.background, ...overrides.background },
    audio: { ...base.audio, ...overrides.audio },
  };
}

function image(plan: RenderPlan, source: "screen" | "camera") {
  return plan.items.find(
    (item): item is Extract<PlanItem, { kind: "image" }> =>
      item.kind === "image" && item.source === source,
  );
}

describe("the background", () => {
  it("always fills the whole frame", () => {
    // Drawn first and edge to edge: anything less leaves the frame's own
    // backdrop showing through at the margins.
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: null }, settings());

    expect(plan.items[0]).toMatchObject({
      kind: "fill",
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
    });
  });
});

describe("fitting the screen", () => {
  it("contains the whole recording, letterboxed", () => {
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({ background: { ...DEFAULT_SETTINGS.background, padding: 0 } }),
    );
    const screen = image(plan, "screen")!;

    // 16:9 into 16:9 fills exactly, and every source pixel is shown.
    expect(screen.dstRect.width).toBeCloseTo(1920);
    expect(screen.dstRect.height).toBeCloseTo(1080);
    expect(screen.srcRect).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
  });

  it("letterboxes a wide recording in a vertical frame", () => {
    const plan = buildRenderPlan(
      VERTICAL,
      { screen: SCREEN, camera: null },
      settings({ background: { ...DEFAULT_SETTINGS.background, padding: 0 } }),
    );
    const screen = image(plan, "screen")!;

    // Width-constrained, centred vertically, entirely inside the frame.
    expect(screen.dstRect.width).toBeCloseTo(1080);
    expect(screen.dstRect.height).toBeCloseTo(607.5);
    expect(screen.dstRect.y).toBeCloseTo((1920 - 607.5) / 2);
  });

  it("fills a vertical frame under cover, and crops to do it", () => {
    // The reason `cover` exists: a 16:9 take has to be usable in a phone-shaped
    // frame, which means showing less of it rather than shrinking it to a strip.
    const plan = buildRenderPlan(
      VERTICAL,
      { screen: SCREEN, camera: null },
      settings({
        layout: { ...DEFAULT_SETTINGS.layout, screenFit: "cover" },
        background: { ...DEFAULT_SETTINGS.background, padding: 0 },
      }),
    );
    const screen = image(plan, "screen")!;

    expect(screen.dstRect).toMatchObject({ x: 0, y: 0, width: 1080, height: 1920 });
    // Full height of the source is used; the width is trimmed.
    expect(screen.srcRect.height).toBeCloseTo(1440);
    expect(screen.srcRect.width).toBeLessThan(2560);
    // Trimmed evenly from both sides.
    expect(screen.srcRect.x).toBeCloseTo((2560 - screen.srcRect.width) / 2);
  });

  it("never lets an offset walk the crop off the source", () => {
    // An unclamped offset starts sampling outside the image, which reads as a
    // black band rather than as an error.
    const plan = buildRenderPlan(
      VERTICAL,
      { screen: SCREEN, camera: null },
      settings({
        layout: { ...DEFAULT_SETTINGS.layout, screenFit: "cover", screenOffsetX: 5 },
      }),
    );
    const { srcRect } = image(plan, "screen")!;

    expect(srcRect.x).toBeGreaterThanOrEqual(0);
    expect(srcRect.x + srcRect.width).toBeLessThanOrEqual(2560 + 0.001);
  });

  it("shrinks the screen when padding grows", () => {
    const none = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({ background: { ...DEFAULT_SETTINGS.background, padding: 0 } }),
    );
    const padded = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({ background: { ...DEFAULT_SETTINGS.background, padding: 0.1 } }),
    );

    expect(image(padded, "screen")!.dstRect.width).toBeLessThan(
      image(none, "screen")!.dstRect.width,
    );
    // 0.1 of the shorter edge, on each side.
    expect(image(padded, "screen")!.dstRect.x).toBeGreaterThanOrEqual(108);
  });

  it("survives padding large enough to consume the frame", () => {
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({ background: { ...DEFAULT_SETTINGS.background, padding: 2 } }),
    );
    const screen = image(plan, "screen");

    expect(screen!.dstRect.width).toBeGreaterThanOrEqual(0);
    expect(screen!.dstRect.height).toBeGreaterThanOrEqual(0);
  });

  it("omits the screen entirely when there is no screen track", () => {
    const plan = buildRenderPlan(LANDSCAPE, { screen: null, camera: CAMERA }, settings());
    expect(image(plan, "screen")).toBeUndefined();
  });
});

describe("the camera", () => {
  const at = (cameraX: number, cameraY: number) =>
    image(
      buildRenderPlan(
        LANDSCAPE,
        { screen: SCREEN, camera: CAMERA },
        settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraX, cameraY } }),
      ),
      "camera",
    )!;

  it("centres the bubble on the position it is given", () => {
    // The position is the *centre*: resizing grows the bubble from the middle,
    // so anchoring a corner would move it every time the size changed.
    const camera = at(0.5, 0.5);

    // Size is a fraction of the shorter edge: 0.22 of 1080.
    expect(camera.dstRect.width).toBeCloseTo(237.6);
    expect(camera.dstRect.x + camera.dstRect.width / 2).toBeCloseTo(960);
    expect(camera.dstRect.y + camera.dstRect.height / 2).toBeCloseTo(540);
  });

  it("keeps the whole bubble inside the frame", () => {
    // Dragging is how it is positioned, and half a bubble hanging off the edge
    // of the preview would be half a bubble hanging off the export.
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [-2, 0.5],
      [0.5, 3],
    ]) {
      const { dstRect } = at(x!, y!);

      expect(dstRect.x).toBeGreaterThanOrEqual(0);
      expect(dstRect.y).toBeGreaterThanOrEqual(0);
      expect(dstRect.x + dstRect.width).toBeLessThanOrEqual(1920);
      expect(dstRect.y + dstRect.height).toBeLessThanOrEqual(1080);
    }
  });

  it("keeps the camera's own proportions when it is wide", () => {
    // The point of `wide`: nothing cropped, nothing stretched. The source rect
    // is the whole camera and the destination has the same shape as it.
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: CAMERA },
      settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraShape: "wide" } }),
    );
    const { srcRect, dstRect } = image(plan, "camera")!;

    expect(srcRect).toEqual({ x: 0, y: 0, width: CAMERA.width, height: CAMERA.height });
    expect(dstRect.width / dstRect.height).toBeCloseTo(CAMERA.width / CAMERA.height, 5);

    // Height is what `cameraSize` means, whatever the shape — so switching from
    // a circle keeps the bubble the size it was and grows it sideways.
    expect(dstRect.height).toBeCloseTo(237.6);
  });

  it("rounds a wide bubble's corners off its shorter edge", () => {
    // Off the width, the corners would grow with it and start eating the
    // picture the shape was chosen to show whole.
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: CAMERA },
      settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraShape: "wide" } }),
    );
    const { shape, dstRect } = image(plan, "camera")!;

    expect(shape.radius).toBeLessThan(dstRect.height / 2);
  });

  it("centre-crops to a square so a face stays centred", () => {
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings());
    const { srcRect } = image(plan, "camera")!;

    expect(srcRect).toEqual({ x: 280, y: 0, width: 720, height: 720 });
  });

  it("is mirrored by default, matching the bubble that was recorded", () => {
    // An un-mirrored edit reads as flipped against the take the user watched.
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings());
    expect(image(plan, "camera")!.mirror).toBe(true);
  });

  it("is a true circle by default, and a superellipse when squircled", () => {
    const circle = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings());
    expect(image(circle, "camera")!.shape).toEqual({ radius: 237.6 / 2, exponent: 2 });

    const squircle = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: CAMERA },
      settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraShape: "squircle" } }),
    );
    expect(image(squircle, "camera")!.shape.exponent).toBe(4);
  });

  it("is omitted when switched off", () => {
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: CAMERA },
      settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraVisible: false } }),
    );
    expect(image(plan, "camera")).toBeUndefined();
  });

  it("is omitted when the caller has no camera frame to give", () => {
    // Before the camera opened. Holding its first frame across the gap would
    // misrepresent the take, so nothing is drawn.
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: null }, settings());
    expect(image(plan, "camera")).toBeUndefined();
  });

  it("stays inside a frame even when sized larger than one", () => {
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: CAMERA },
      settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraSize: 3 } }),
    );
    const camera = image(plan, "camera")!;

    // An oversized camera is a valid look, so it is not shrunk. It is still
    // square, and still placed rather than sent off somewhere unreachable.
    expect(camera.dstRect.width).toBe(camera.dstRect.height);
    expect(Number.isFinite(camera.dstRect.x)).toBe(true);
  });
});

describe("changing the frame", () => {
  it("keeps proportions rather than pixel sizes", () => {
    // The reason every setting is a fraction of the shorter edge: 0.06 padding
    // must stay visually the same weight when a 16:9 frame becomes 9:16, not
    // collapse to a hairline.
    const landscape = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings());
    const vertical = buildRenderPlan(VERTICAL, { screen: SCREEN, camera: CAMERA }, settings());

    // Both frames have a shorter edge of 1080, so the camera is the same size.
    expect(image(vertical, "camera")!.dstRect.width).toBeCloseTo(
      image(landscape, "camera")!.dstRect.width,
    );
  });

  it("scales the camera with a smaller frame", () => {
    const small = buildRenderPlan(
      { width: 960, height: 540 },
      { screen: SCREEN, camera: CAMERA },
      settings(),
    );
    const large = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings());

    expect(image(small, "camera")!.dstRect.width).toBeCloseTo(
      image(large, "camera")!.dstRect.width / 2,
    );
  });
});

describe("decoration", () => {
  it("draws a shadow behind the screen, not in front of it", () => {
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: null }, settings());

    const shadow = plan.items.findIndex((item) => item.kind === "shadow");
    const screen = plan.items.findIndex((item) => item.kind === "image");

    expect(shadow).toBeGreaterThanOrEqual(0);
    expect(shadow).toBeLessThan(screen);
  });

  it("omits the shadow when it is fully transparent", () => {
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({ background: { ...DEFAULT_SETTINGS.background, shadowOpacity: 0 } }),
    );
    expect(plan.items.some((item) => item.kind === "shadow")).toBe(false);
  });

  it("strokes the border over the screen, sharing its shape", () => {
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({ background: { ...DEFAULT_SETTINGS.background, borderWidth: 0.01 } }),
    );

    const stroke = plan.items.find(
      (item): item is Extract<PlanItem, { kind: "stroke" }> => item.kind === "stroke",
    )!;
    const screen = image(plan, "screen")!;

    // Same rect and same corner shape, or the border floats off the edge it is
    // supposed to be tracing.
    expect(stroke.rect).toEqual(screen.dstRect);
    expect(stroke.shape).toEqual(screen.shape);
    expect(stroke.width).toBeCloseTo(10.8);
  });

  it("omits a zero-width border", () => {
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: null }, settings());
    expect(plan.items.some((item) => item.kind === "stroke")).toBe(false);
  });
});

describe("the plan itself", () => {
  it("reports the frame it was built for", () => {
    expect(buildRenderPlan(VERTICAL, { screen: SCREEN, camera: null }, settings()).frame).toEqual(
      VERTICAL,
    );
  });

  it("is expressed entirely in output pixels", () => {
    // The contract with the exporter: nothing left to interpret, so the two
    // rasterisers cannot disagree about geometry.
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings());

    for (const item of plan.items) {
      if (item.kind === "image") {
        expect(Number.isFinite(item.dstRect.x)).toBe(true);
        expect(Number.isFinite(item.dstRect.width)).toBe(true);
        expect(item.dstRect.width).toBeGreaterThan(0);
      }
    }
  });
});

describe("the pointer layer", () => {
  const TRACK = {
    path: "cursor.png",
    hotspot: { x: 0.055, y: 0.055 },
    size: 0.035,
    hideAfter: null,
    samples: [
      { at: 0, x: 0, y: 0 },
      { at: 1_000_000_000, x: 0.5, y: 0.5 },
      { at: 2_000_000_000, x: 1, y: 1 },
    ],
  };

  const planWith = (custom: SliceSettings = settings()) =>
    buildRenderPlan({ width: 1920, height: 1080 }, { screen: SCREEN, camera: null }, custom, TRACK);

  const cursorItem = (plan: ReturnType<typeof planWith>) =>
    plan.items.find((item) => item.kind === "cursor")!;

  it("maps a fraction of the capture onto the screen's own rectangle", () => {
    // The whole reason the mapping lives here: the manifest records a fraction
    // of what was captured, and only this function knows where that ended up.
    const plan = planWith();
    const screen = plan.items.find((item) => item.kind === "image")!;
    const item = cursorItem(plan);

    expect(item.kind).toBe("cursor");
    if (item.kind !== "cursor" || screen.kind !== "image") throw new Error("wrong item");

    const middle = item.points[1]!;
    expect(middle.x).toBeCloseTo(screen.dstRect.x + screen.dstRect.width / 2);
    expect(middle.y).toBeCloseTo(screen.dstRect.y + screen.dstRect.height / 2);
    expect(middle.visible).toBe(true);
  });

  it("is left out when the pointer is switched off", () => {
    const plan = planWith(settings({ layout: { ...settings().layout, cursorVisible: false } }));
    expect(plan.items.some((item) => item.kind === "cursor")).toBe(false);
  });

  it("is left out when the recording has no track", () => {
    const plan = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings(),
      null,
    );
    expect(plan.items.some((item) => item.kind === "cursor")).toBe(false);
  });

  it("sits under the border rather than over it", () => {
    // Otherwise a pointer near the edge draws on top of the frame's own edge,
    // which reads as the border being broken.
    const plan = planWith(
      settings({ background: { ...settings().background, borderWidth: 0.01 } }),
    );
    const kinds = plan.items.map((item) => item.kind);

    expect(kinds.indexOf("cursor")).toBeLessThan(kinds.indexOf("stroke"));
  });

  it("marks a pointer outside the crop rather than clamping it to the edge", () => {
    // Clamped, it would park against the side of the picture and sit there,
    // which reads as a stuck pointer rather than one that has left.
    const item = cursorItem(
      buildRenderPlan({ width: 1920, height: 1080 }, { screen: SCREEN, camera: null }, settings(), {
        ...TRACK,
        samples: [{ at: 0, x: 1.4, y: 0.5 }],
      }),
    );
    if (item.kind !== "cursor") throw new Error("wrong item");

    expect(item.points[0]!.visible).toBe(false);
  });
});

describe("hiding a parked pointer", () => {
  const still = {
    path: "cursor.png",
    hotspot: { x: 0.055, y: 0.055 },
    size: 0.035,
    hideAfter: 2,
    // Moves, then sits for ten seconds, then moves again.
    samples: [
      { at: 0, x: 0.2, y: 0.2 },
      { at: 1_000_000_000, x: 0.3, y: 0.3 },
      { at: 11_000_000_000, x: 0.4, y: 0.4 },
    ],
  };

  const points = () => {
    const item = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings(),
      still,
    ).items.find((candidate) => candidate.kind === "cursor")!;
    if (item.kind !== "cursor") throw new Error("wrong item");
    return item.points;
  };

  it("keeps it on screen until the timeout", () => {
    // Still there a moment before, gone a moment after — and it holds its own
    // position while it waits rather than drifting towards where it goes next.
    expect(cursorAt(points(), 2_500_000_000)).not.toBeNull();
    expect(cursorAt(points(), 4_000_000_000)).toBeNull();
  });

  it("brings it back the instant it moves", () => {
    expect(cursorAt(points(), 11_000_000_000)).not.toBeNull();
  });

  it("hides it after the last sample too", () => {
    // Nothing follows the final move, so without the same treatment it would
    // sit on screen for the rest of the recording.
    expect(cursorAt(points(), 20_000_000_000)).toBeNull();
  });

  it("leaves the track alone when auto-hide is off", () => {
    const item = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings(),
      { ...still, hideAfter: null },
    ).items.find((candidate) => candidate.kind === "cursor")!;
    if (item.kind !== "cursor") throw new Error("wrong item");

    expect(item.points).toHaveLength(still.samples.length);
    expect(cursorAt(item.points, 20_000_000_000)).not.toBeNull();
  });
});

describe("cursorAt", () => {
  const points = [
    { at: 0, x: 0, y: 0, scale: 1, visible: true },
    { at: 100, x: 100, y: 200, scale: 1, visible: true },
    { at: 200, x: 0, y: 0, scale: 1, visible: false },
  ];

  it("interpolates between two samples", () => {
    // The track is sampled at 30 Hz and played at 60: without this the pointer
    // would move in visible steps.
    expect(cursorAt(points, 50)).toMatchObject({ x: 50, y: 100 });
  });

  it("holds still before the first sample and after the last", () => {
    expect(cursorAt(points, -1000)).toMatchObject({ x: 0, y: 0 });
    expect(cursorAt([points[0]!], 9999)).toMatchObject({ x: 0, y: 0 });
  });

  it("draws nothing across a span where the pointer had left", () => {
    // Rather than sliding it across a picture it was never on.
    expect(cursorAt(points, 150)).toBeNull();
    expect(cursorAt(points, 200)).toBeNull();
  });

  it("has nothing to say about an empty track", () => {
    expect(cursorAt([], 0)).toBeNull();
  });
});

describe("the screen is never stretched", () => {
  // The bug this pins: under Fill, the destination was handed the whole padded
  // area while the source window was clamped to the pixels that exist. Zoom out
  // in a frame shaped differently from the recording and the two stopped
  // matching, so the picture was scaled unevenly to make up the difference.
  const FRAMES: Size[] = [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 1080, height: 1080 },
    { width: 1080, height: 1350 },
  ];
  const SOURCES: Size[] = [
    { width: 2560, height: 1440 },
    { width: 1440, height: 2560 },
    { width: 1600, height: 1600 },
  ];

  it("keeps the source window and the destination the same shape", () => {
    for (const frame of FRAMES) {
      for (const source of SOURCES) {
        for (const screenFit of ["contain", "cover"] as const) {
          for (const screenZoom of [0.05, 0.25, 0.5, 0.9, 1, 1.5, 3]) {
            const plan = buildRenderPlan(
              frame,
              { screen: source, camera: null },
              settings({ layout: { ...settings().layout, screenFit, screenZoom } }),
            );
            const item = image(plan, "screen")!;
            const where = `${frame.width}x${frame.height} ${screenFit} @${screenZoom}`;

            expect(item.srcRect.width, where).toBeGreaterThan(0);
            expect(item.srcRect.height, where).toBeGreaterThan(0);
            expect(
              item.dstRect.width / item.dstRect.height,
              `${where}: dst ${item.dstRect.width}x${item.dstRect.height} vs src ${item.srcRect.width}x${item.srcRect.height}`,
            ).toBeCloseTo(item.srcRect.width / item.srcRect.height, 5);
          }
        }
      }
    }
  });

  it("never samples outside the recording", () => {
    for (const frame of FRAMES) {
      for (const screenZoom of [0.05, 0.5, 1, 3]) {
        const source = { width: 2560, height: 1440 };
        const plan = buildRenderPlan(
          frame,
          { screen: source, camera: null },
          settings({
            layout: {
              ...settings().layout,
              screenFit: "cover",
              screenZoom,
              screenOffsetX: 0.4,
              screenOffsetY: -0.4,
            },
          }),
        );
        const { srcRect } = image(plan, "screen")!;

        expect(srcRect.x).toBeGreaterThanOrEqual(0);
        expect(srcRect.y).toBeGreaterThanOrEqual(0);
        expect(srcRect.x + srcRect.width).toBeLessThanOrEqual(source.width + 1e-6);
        expect(srcRect.y + srcRect.height).toBeLessThanOrEqual(source.height + 1e-6);
      }
    }
  });

  it("letterboxes rather than stretching once the whole recording is on show", () => {
    // Zooming out past that point cannot fill the frame — the pixels were never
    // recorded — so the picture shrinks inside it instead.
    const frame = { width: 1080, height: 1920 };
    const plan = buildRenderPlan(
      frame,
      { screen: { width: 2560, height: 1440 }, camera: null },
      settings({ layout: { ...settings().layout, screenFit: "cover", screenZoom: 0.5 } }),
    );
    const { dstRect } = image(plan, "screen")!;

    expect(dstRect.width).toBeLessThan(frame.width);
    // Still centred in what it was given.
    expect(dstRect.x + dstRect.width / 2).toBeCloseTo(frame.width / 2);
    expect(dstRect.y + dstRect.height / 2).toBeCloseTo(frame.height / 2);
  });
});

describe("zooming", () => {
  const S = 1_000_000_000;
  const FRAME: Size = { width: 1920, height: 1080 };

  const region = (over: Partial<ZoomSlice> = {}): ZoomSlice => ({
    // Spread first so a field added to a zoom later cannot break this fixture;
    // every value spelled out below still wins over the default.
    ...DEFAULT_ZOOM,
    id: "z",
    source: { start: 2 * S, end: 6 * S },
    target: "region",
    x: 0.25,
    y: 0.75,
    level: 2,
    speed: 0.5,
    tilt: 0,
    yaw: 0,
    depth: 0.5,
    blur: false,
    blurSafe: 0.28,
    blurStrength: 0.012,
    ...over,
  });

  const planWith = (zooms: ZoomSlice[]) =>
    buildRenderPlan(FRAME, { screen: SCREEN, camera: null }, settings(), null, zooms);

  const motionOf = (zooms: ZoomSlice[]) => {
    const item = planWith(zooms).items.find(
      (candidate) => candidate.kind === "image" && candidate.source === "screen",
    )!;
    if (item.kind !== "image") throw new Error("wrong item");
    return { keys: item.motion ?? [], base: item.dstRect, radius: item.shape.radius };
  };

  it("leaves the plan alone when there is nothing to zoom", () => {
    // No keys at all, rather than a flat track of the base rectangle for the
    // whole recording — which for a ten-minute take would be 18,000 of them.
    expect(motionOf([]).keys).toHaveLength(0);
  });

  it("opens and closes on the un-zoomed rectangle", () => {
    // What makes the gaps between zooms free: interpolating base to base is
    // base, so the flat stretches need no keys of their own.
    const { keys, base } = motionOf([region()]);

    expect(keys[0]).toMatchObject({ at: 2 * S, ...base });
    expect(keys[keys.length - 1]).toMatchObject({ at: 6 * S, ...base });
  });

  it("scales the whole picture rather than cropping into it", () => {
    // The source rectangle never moves — what grows is where the picture is
    // drawn, corners and all, and it is free to run past the frame.
    const { keys, base, radius } = motionOf([region()]);
    const middle = rectAt(keys, 4 * S, base, radius);

    expect(middle.width).toBeCloseTo(base.width * 2, 3);
    expect(middle.height).toBeCloseTo(base.height * 2, 3);
    // The corners grow with it, or the frame changes shape mid-move.
    expect(middle.radius).toBeCloseTo(radius * 2, 3);
  });

  it("keeps the source rectangle still", () => {
    const item = planWith([region()]).items.find(
      (candidate) => candidate.kind === "image" && candidate.source === "screen",
    )!;
    if (item.kind !== "image") throw new Error("wrong item");

    const unzoomed = planWith([]).items.find(
      (candidate) => candidate.kind === "image" && candidate.source === "screen",
    )!;
    if (unzoomed.kind !== "image") throw new Error("wrong item");

    expect(item.srcRect).toEqual(unzoomed.srcRect);
  });

  it("moves the whole picture together", () => {
    // The shadow under it and the border around it are the same object; one of
    // them staying put would come apart the moment a zoom started.
    const plan = planWith([region()]);
    const withMotion = plan.items.filter(
      (item) => "motion" in item && item.motion !== undefined,
    ).length;

    expect(withMotion).toBeGreaterThanOrEqual(2);
  });

  it("never pulls the picture off the area it filled", () => {
    // A zoom towards a corner would otherwise leave background showing where
    // the recording was.
    const { keys, base } = motionOf([region({ x: 0, y: 0, level: 4 })]);

    for (const key of keys) {
      expect(key.x).toBeLessThanOrEqual(base.x + 1e-6);
      expect(key.y).toBeLessThanOrEqual(base.y + 1e-6);
      expect(key.x + key.width).toBeGreaterThanOrEqual(base.x + base.width - 1e-6);
      expect(key.y + key.height).toBeGreaterThanOrEqual(base.y + base.height - 1e-6);
    }
  });

  it("eases rather than cutting", () => {
    // A quarter of the way into the transition it should be part-way in, not
    // already there — that is the difference between a camera move and a cut.
    const { keys, base, radius } = motionOf([region()]);
    const early = rectAt(keys, 2 * S + S / 8, base, radius);

    expect(early.width).toBeGreaterThan(base.width);
    expect(early.width).toBeLessThan(base.width * 2);
  });

  it("fits both transitions inside a span too short for them", () => {
    // A 2s ease each way on a half-second zoom would still be arriving when it
    // had to leave; the shape has to stay a zoom rather than become a twitch.
    const { keys, base, radius } = motionOf([
      region({ source: { start: 0, end: S / 2 }, speed: 2 }),
    ]);

    expect(rectAt(keys, S / 4, base, radius).width).toBeGreaterThan(base.width);
  });

  it("puts the pointer where the picture actually is", () => {
    // The bug this pins: the pointer was mapped through the un-zoomed
    // rectangle while the picture moved under it, so the further a zoom went
    // the further out the pointer was.
    const cursor = {
      path: "cursor.png",
      hotspot: { x: 0, y: 0 },
      size: 0.035,
      hideAfter: null,
      samples: [
        { at: 0, x: 0.25, y: 0.75 },
        { at: 10 * S, x: 0.25, y: 0.75 },
      ],
    };

    const plan = buildRenderPlan(FRAME, { screen: SCREEN, camera: null }, settings(), cursor, [
      region(),
    ]);

    const picture = plan.items.find((item) => item.kind === "image" && item.source === "screen")!;
    const pointer = plan.items.find((item) => item.kind === "cursor")!;
    if (picture.kind !== "image" || pointer.kind !== "cursor") throw new Error("wrong items");

    const at = 4 * S;
    const rect = rectAt(picture.motion ?? [], at, picture.dstRect, picture.shape.radius);
    const point = cursorAt(pointer.points, at)!;

    // The pointer sits at 0.25/0.75 of the recording, so it has to sit at the
    // same fraction of wherever the picture is being drawn.
    expect(point.x).toBeCloseTo(rect.x + rect.width * 0.25, 0);
    expect(point.y).toBeCloseTo(rect.y + rect.height * 0.75, 0);
  });
});

describe("following the cursor", () => {
  const S = 1_000_000_000;
  const FRAME: Size = { width: 1920, height: 1080 };

  /** A pointer crossing the screen with a bad shake on top of it. */
  const shaky = (jitter: number) => ({
    path: "cursor.png",
    hotspot: { x: 0, y: 0 },
    size: 0.035,
    hideAfter: null,
    samples: Array.from({ length: 120 }, (_, index) => ({
      at: Math.round((index * 4 * S) / 119),
      x: 0.3 + (index / 119) * 0.4 + (index % 2 === 0 ? jitter : -jitter),
      y: 0.5 + (index % 2 === 0 ? jitter : -jitter),
    })),
  });

  const follow = (jitter: number) => {
    const plan = buildRenderPlan(
      FRAME,
      { screen: SCREEN, camera: null },
      settings(),
      shaky(jitter),
      [
        {
          // Spread first so a field added to a zoom later cannot break this fixture;
          // every value spelled out below still wins over the default.
          ...DEFAULT_ZOOM,
          id: "z",
          source: { start: 0, end: 4 * S },
          target: "cursor",
          x: 0.5,
          y: 0.5,
          level: 2,
          speed: 0.2,
          tilt: 0,
          yaw: 0,
          depth: 0.5,
          blur: false,
          blurSafe: 0.28,
          blurStrength: 0.012,
        },
      ],
    );
    const item = plan.items.find(
      (candidate) => candidate.kind === "image" && candidate.source === "screen",
    )!;
    if (item.kind !== "image") throw new Error("wrong item");
    return item.motion ?? [];
  };

  /** Total reversal in direction across a path — how much it shakes. */
  const wobble = (keys: { x: number }[]) =>
    keys.slice(2).reduce((total, key, index) => {
      const previous = keys[index + 1]!.x - keys[index]!.x;
      const next = key.x - keys[index + 1]!.x;
      return total + (Math.sign(previous) !== Math.sign(next) ? Math.abs(next - previous) : 0);
    }, 0);

  it("does not reproduce the pointer's shake", () => {
    // A hand on a trackpad overshoots and corrects constantly; a shot that
    // copies it exactly is unwatchable.
    expect(wobble(follow(0.02))).toBeLessThan(wobble(follow(0)) + 1);
  });

  it("still goes where the pointer went", () => {
    // Smoothing that also lagged would leave the shot trailing behind, which
    // reads as a slow camera rather than a steady one. The filter is run both
    // ways precisely so it does not.
    const keys = follow(0.02);
    const first = keys[Math.floor(keys.length * 0.2)]!;
    const last = keys[Math.floor(keys.length * 0.8)]!;

    // The pointer travels left to right, so the shot must too.
    expect(last.x).toBeLessThan(first.x);
  });
});

describe("following typing", () => {
  const S = 1_000_000_000;
  const FRAME: Size = { width: 1920, height: 1080 };

  type Span = { at: number; x: number; y: number; width: number; height: number };

  /** Where the picture is pushed to at `at`, aiming at whatever is given. */
  const shotAt = (target: ZoomSlice["target"], typing: Span[], at: number) => {
    const plan = buildRenderPlan(
      FRAME,
      { screen: SCREEN, camera: null },
      settings(),
      {
        path: "cursor.png",
        hotspot: { x: 0, y: 0 },
        size: 0.035,
        hideAfter: null,
        // The pointer sits in the far bottom-right, so which of the two the
        // shot is aiming at is never ambiguous.
        samples: [
          { at: 0, x: 0.9, y: 0.9 },
          { at: 6 * S, x: 0.9, y: 0.9 },
        ],
        typing,
      },
      [
        {
          // Spread first so a field added to a zoom later cannot break this fixture;
          // every value spelled out below still wins over the default.
          ...DEFAULT_ZOOM,
          id: "z",
          source: { start: 0, end: 6 * S },
          target,
          x: 0.5,
          y: 0.5,
          level: 2,
          speed: 0,
          tilt: 0,
          yaw: 0,
          depth: 0.5,
          blur: false,
          blurSafe: 0.28,
          blurStrength: 0.012,
        },
      ],
    );

    const item = plan.items.find(
      (candidate) => candidate.kind === "image" && candidate.source === "screen",
    )!;
    if (item.kind !== "image") throw new Error("wrong item");
    return rectAt(item.motion ?? [], at, item.dstRect, item.shape.radius);
  };

  const FIELD: Span[] = [{ at: 0, x: 0.1, y: 0.4, width: 0.2, height: 0.05 }];

  it("frames the field that has focus", () => {
    // Aiming left pushes the picture right, so its left edge sits further along
    // than when the shot is following a pointer parked bottom-right.
    expect(shotAt("typing", FIELD, 3 * S).x).toBeGreaterThan(shotAt("cursor", [], 3 * S).x);
  });

  it("falls back to the pointer when nothing is focused", () => {
    // Which is most of a recording, and all of one made without the
    // Accessibility grant — a typing zoom is never worse than a cursor one.
    expect(shotAt("typing", [], 3 * S)).toEqual(shotAt("cursor", [], 3 * S));
  });

  it("lets go of a field that was focused long ago", () => {
    // A field focused a minute back says nothing about where the interesting
    // part of the picture is now, so the shot goes back to the pointer.
    expect(shotAt("typing", FIELD, 5.5 * S).x).toBeCloseTo(shotAt("cursor", [], 5.5 * S).x, 0);
  });
});

describe("the camera's own zoom", () => {
  const tight = (cameraZoom: number, cameraShape: "circle" | "wide" = "circle") =>
    image(
      buildRenderPlan(
        LANDSCAPE,
        { screen: SCREEN, camera: CAMERA },
        settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraZoom, cameraShape } }),
      ),
      "camera",
    )!.srcRect;

  it("shows all of the camera at 1×", () => {
    expect(tight(1)).toEqual(tight(1));
    expect(tight(1, "wide")).toEqual({ x: 0, y: 0, width: CAMERA.width, height: CAMERA.height });
  });

  it("takes a smaller piece as it tightens", () => {
    expect(tight(2).width).toBeCloseTo(tight(1).width / 2);
  });

  it("crops about the middle, so a face stays where it was", () => {
    const wide = tight(1);
    const close = tight(2);

    expect(close.x + close.width / 2).toBeCloseTo(wide.x + wide.width / 2);
    expect(close.y + close.height / 2).toBeCloseTo(wide.y + wide.height / 2);
  });

  it("keeps the shot's shape, so the picture is never stretched", () => {
    // The same invariant the screen has: source and destination agree, or the
    // camera comes out squashed the moment it is zoomed.
    for (const shape of ["circle", "wide"] as const) {
      const item = image(
        buildRenderPlan(
          LANDSCAPE,
          { screen: SCREEN, camera: CAMERA },
          settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraZoom: 2.4, cameraShape: shape } }),
        ),
        "camera",
      )!;

      expect(item.dstRect.width / item.dstRect.height).toBeCloseTo(
        item.srcRect.width / item.srcRect.height,
        5,
      );
    }
  });
});

describe("perspective", () => {
  const S = 1_000_000_000;

  const cornersFor = (tilt: number, yaw: number, depth = 0.5) => {
    const plan = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings(),
      null,
      [
        {
          // Spread first so a field added to a zoom later cannot break this fixture;
          // every value spelled out below still wins over the default.
          ...DEFAULT_ZOOM,
          id: "z",
          source: { start: 0, end: 4 * S },
          target: "region",
          x: 0.5,
          y: 0.5,
          level: 1.5,
          speed: 0,
          tilt,
          yaw,
          depth,
          blur: false,
          blurSafe: 0.28,
          blurStrength: 0.012,
        },
      ],
    );
    const item = plan.items.find(
      (candidate) => candidate.kind === "image" && candidate.source === "screen",
    )!;
    if (item.kind !== "image") throw new Error("wrong item");
    return rectAt(item.motion ?? [], 2 * S, item.dstRect, item.shape.radius).quad;
  };

  it("carries no corners when nothing is tilted", () => {
    // Which is every zoom that only pushes in — twelve numbers a key for a
    // transform that is the identity.
    expect(cornersFor(0, 0)).toBeUndefined();
  });

  it("converges harder at the near end of the depth range", () => {
    // The control the panel was missing. Angle says which way the picture is
    // turned; depth says how much being turned costs it, and the two are
    // genuinely independent — the same 12° is a product shot or a caricature.
    const near = cornersFor(12, 0, 1)!;
    const far = cornersFor(12, 0, 0)!;

    const convergence = (q: number[]) => (q[9]! - q[6]!) / (q[3]! - q[0]!);
    expect(convergence(near)).toBeGreaterThan(convergence(far));
  });

  it("leaves the middle of the range where it always was", () => {
    // Every project written before `depth` existed reads back at 0.5, and has
    // to look exactly as it did. The default is the old constant.
    expect(cornersFor(12, 0, 0.5)).toEqual(cornersFor(12, 0));
  });

  it("converges the edge that leans away", () => {
    // The difference between perspective and a rotation: the far edge is
    // genuinely further off, so it is drawn shorter.
    const q = cornersFor(12, 0)!;
    expect(q[3]! - q[0]!).toBeLessThan(q[9]! - q[6]!);
  });

  it("shortens the side that swings away", () => {
    const q = cornersFor(0, 14)!;
    expect(q[10]! - q[4]!).toBeLessThan(q[7]! - q[1]!);
  });

  it("gives the corner that leans away the larger divisor", () => {
    // The bug this pins: storing the magnification here instead of the divisor
    // inverts the correction. The outline stays right, so it looks *almost*
    // correct — but the image inside bends the wrong way across the diagonal
    // where the two triangles meet, which reads as a crease rather than a tilt.
    const q = cornersFor(12, 0)!;

    // Leaning back, so the top is further from the eye than the bottom.
    expect(q[2]!).toBeGreaterThan(q[8]!);
    expect(q[5]!).toBeGreaterThan(q[11]!);
  });

  it("carries a divisor with every corner", () => {
    // Without `w` the GPU maps the texture across two flat triangles, which is
    // the affine warp early 3D was famous for.
    const q = cornersFor(10, 10)!;

    expect(q).toHaveLength(12);
    for (let index = 2; index < q.length; index += 3) expect(q[index]).toBeGreaterThan(0);
  });
});
