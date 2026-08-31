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
  captionAt,
  cursorAt,
  layoutBoxes,
  rectAt,
  shapeAspect,
  SHADOW_SPREAD,
  type CaptionWord,
  type PlanItem,
  type Rect,
  type RenderPlan,
  type Size,
} from "./layout.js";
import {
  DEFAULT_SETTINGS,
  DEFAULT_ZOOM,
  type LayoutPreset,
  type LayoutSettings,
  type SliceSettings,
  type ZoomSlice,
} from "./project.js";
import type { CursorKind } from "./manifest.js";

/** Every arrangement, so a sweep cannot quietly skip the one that broke. */
const PRESETS: LayoutPreset[] = [
  "over-full",
  "over-padded",
  "beside",
  "stacked",
  "split",
  "split-stacked",
  "screen-full",
  "screen-padded",
  "camera-full",
  "camera-padded",
  "custom",
];

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
    captions: { ...base.captions, ...overrides.captions },
  };
}

/** Settings that draw the pointer exactly where it was sampled. */
function unsmoothed(): SliceSettings {
  return settings({ layout: { ...DEFAULT_SETTINGS.layout, cursorSmoothing: 0 } });
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
        layout: { ...DEFAULT_SETTINGS.layout, preset: "over-full" },
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
        layout: { ...DEFAULT_SETTINGS.layout, preset: "over-full", screenOffsetX: 5 },
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
        // The size is spelled out rather than inherited: these assert exact
        // pixels, and a default nobody thought about this file when changing
        // should not read as the geometry being wrong.
        settings({
          layout: {
            ...DEFAULT_SETTINGS.layout,
            cameraWidth: 0.22,
            cameraHeight: 0.22,
            cameraX,
            cameraY,
          },
        }),
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
      settings({
        layout: {
          ...DEFAULT_SETTINGS.layout,
          cameraShape: "wide",
          // The proportions the shape picker writes for `wide`. The shape sets
          // the radius; the box is what the geometry reads.
          cameraWidth: 0.22 * shapeAspect("wide", CAMERA),
          cameraHeight: 0.22,
        },
      }),
    );
    const { srcRect, dstRect } = image(plan, "camera")!;

    expect(srcRect.x).toBeCloseTo(0, 6);
    expect(srcRect.y).toBeCloseTo(0, 6);
    expect(srcRect.width).toBeCloseTo(CAMERA.width, 6);
    expect(srcRect.height).toBeCloseTo(CAMERA.height, 6);
    expect(dstRect.width / dstRect.height).toBeCloseTo(CAMERA.width / CAMERA.height, 5);

    // Height is what `cameraHeight` means, whatever the shape — so switching from
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

  it("is a true circle when circled, and a superellipse when squircled", () => {
    const shaped = (cameraShape: "circle" | "squircle") =>
      image(
        buildRenderPlan(
          LANDSCAPE,
          { screen: SCREEN, camera: CAMERA },
          settings({
            layout: {
              ...DEFAULT_SETTINGS.layout,
              cameraWidth: 0.22,
              cameraHeight: 0.22,
              cameraShape,
            },
          }),
        ),
        "camera",
      )!.shape;

    // A circle is the rounded rectangle taken to its limit rather than a case
    // of its own: the radius is half the bubble, and the exponent is the plain
    // ellipse. Nothing here special-cases it.
    expect(shaped("circle")).toEqual({ radius: 237.6 / 2, exponent: 2 });
    expect(shaped("squircle").exponent).toBe(4);
  });

  it("stands off the corner it is parked in", () => {
    // The defaults are three numbers that only work together: the position is
    // the bubble's centre, so how much room is left is whatever half a bubble
    // does not take. Set too far into the corner for its size, `cameraRect`
    // clamps it and it sits flush on the edge — touching the frame, with a
    // shadow it has nowhere to cast.
    const { dstRect } = image(
      buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings()),
      "camera",
    )!;
    const unit = Math.min(LANDSCAPE.width, LANDSCAPE.height);

    // Bottom right, and clear of both edges by a visible margin.
    expect(dstRect.x).toBeGreaterThan(LANDSCAPE.width / 2);
    expect(dstRect.y).toBeGreaterThan(LANDSCAPE.height / 2);
    expect(LANDSCAPE.width - (dstRect.x + dstRect.width)).toBeGreaterThan(unit * 0.04);
    expect(LANDSCAPE.height - (dstRect.y + dstRect.height)).toBeGreaterThan(unit * 0.04);
  });

  it("sits on a shadow of its own, drawn under it", () => {
    // Without one the bubble is stuck to the picture like a sticker. It has to
    // be the item immediately before the camera, or it is a dark shape floating
    // over the thing it belongs to.
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings());
    const index = plan.items.findIndex((item) => item.kind === "image" && item.source === "camera");
    const under = plan.items[index - 1]!;
    if (under.kind !== "shadow") throw new Error("the camera casts no shadow");

    const camera = image(plan, "camera")!;
    const bleed = (under.blur / 2) * SHADOW_SPREAD;

    expect(under.shape).toEqual(camera.shape);
    expect(under.rect.x).toBeCloseTo(camera.dstRect.x - bleed, 6);
    expect(under.rect.width).toBeCloseTo(camera.dstRect.width + bleed * 2, 6);
  });

  it("measures that shadow against the bubble, not against the frame", () => {
    // Every other distance here is a fraction of the frame's shorter edge, and
    // the bubble is a fraction of that again — so a blur sized for the screen
    // is one the bubble disappears into, and a drop sized for the screen puts
    // the shadow out from under it altogether.
    const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, settings());
    const shadows = plan.items.filter((item) => item.kind === "shadow");
    const [picture, bubble] = shadows;
    if (picture?.kind !== "shadow" || bubble?.kind !== "shadow") throw new Error("two expected");

    expect(bubble.blur).toBeLessThan(picture.blur);
    expect(bubble.dy).toBeLessThan(picture.dy);
    // And lighter, because it lies on the picture rather than on the backdrop.
    expect(bubble.color).not.toBe(picture.color);
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
      settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraWidth: 3, cameraHeight: 3 } }),
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

  it("strokes the border round the outside of the screen", () => {
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({ background: { ...DEFAULT_SETTINGS.background, borderWidth: 0.01 } }),
    );

    const stroke = plan.items.find(
      (item): item is Extract<PlanItem, { kind: "stroke" }> => item.kind === "stroke",
    )!;
    const screen = image(plan, "screen")!;
    const width = 10.8;

    // A frame around the picture, not over it. Both rasterisers stroke inside
    // the shape they are given, so the ring lands between the picture's edge
    // and this — which means this box is the picture grown by the border's
    // width, corner radius included, or the ring changes width at the corners.
    expect(stroke.width).toBeCloseTo(width);
    expect(stroke.rect.x).toBeCloseTo(screen.dstRect.x - width);
    expect(stroke.rect.y).toBeCloseTo(screen.dstRect.y - width);
    expect(stroke.rect.width).toBeCloseTo(screen.dstRect.width + width * 2);
    expect(stroke.rect.height).toBeCloseTo(screen.dstRect.height + width * 2);
    expect(stroke.shape.radius).toBeCloseTo(screen.shape.radius + width);
    expect(stroke.shape.exponent).toBe(screen.shape.exponent);

    // And the shadow is cast by the two of them together, or the border reads
    // as a ring painted on the background rather than as the picture's edge.
    const shadow = plan.items.find(
      (item): item is Extract<PlanItem, { kind: "shadow" }> => item.kind === "shadow",
    )!;
    expect(shadow.shape.radius).toBeCloseTo(stroke.shape.radius);
  });

  it("takes the border's opacity into its colour", () => {
    const plan = buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({
        background: {
          ...DEFAULT_SETTINGS.background,
          borderWidth: 0.01,
          borderColor: "#ff0000",
          borderOpacity: 0.5,
        },
      }),
    );

    const stroke = plan.items.find(
      (item): item is Extract<PlanItem, { kind: "stroke" }> => item.kind === "stroke",
    )!;
    // One colour with an alpha in it, because a plan item has no opacity of its
    // own and both rasterisers read the alpha off the colour.
    expect(stroke.color).toBe("rgba(255, 0, 0, 0.5)");
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
    shapes: { arrow: { path: "cursor.png", hotspot: { x: 0.055, y: 0.055 } } },
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
    // Unsmoothed, so a point is still the sample it came from — where the
    // smoothing puts it instead is pinned on its own below.
    const plan = planWith(unsmoothed());
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

describe("the pointer changing shape", () => {
  const TONE = {
    shapes: {
      arrow: { path: "arrow.png", hotspot: { x: 0.055, y: 0.055 } },
      hand: { path: "hand.png", hotspot: { x: 0.3754, y: 0.055 } },
      text: { path: "text.png", hotspot: { x: 0.5, y: 0.5 } },
    },
    size: 0.035,
    hideAfter: null,
  };

  /** Every pointer item in the plan for a track that hovers a link mid-way. */
  const itemsFor = (
    samples: { at: number; x: number; y: number; kind?: CursorKind; hand?: boolean }[],
  ) =>
    buildRenderPlan({ width: 1920, height: 1080 }, { screen: SCREEN, camera: null }, settings(), {
      ...TONE,
      samples,
    }).items.filter((item) => item.kind === "cursor");

  const HOVER = [
    { at: 0, x: 0.2, y: 0.2 },
    { at: 1_000_000_000, x: 0.4, y: 0.4, hand: true },
    { at: 2_000_000_000, x: 0.6, y: 0.6, hand: true },
    { at: 3_000_000_000, x: 0.8, y: 0.8 },
  ];

  it("draws exactly one pointer at every moment of a hover", () => {
    // The invariant the split exists to hold. Getting the handover wrong shows
    // as either a blink or a doubled pointer, and both are only ever noticed
    // after the file is written.
    const items = itemsFor(HOVER);

    for (let at = 0; at <= 3_000_000_000; at += 10_000_000) {
      const drawn = items.filter(
        (item) => item.kind === "cursor" && cursorAt(item.points, at) !== null,
      );

      expect(drawn, `at ${at}`).toHaveLength(1);
    }
  });

  it("draws the hand for the span the system showed one", () => {
    const items = itemsFor(HOVER);
    // The image actually on screen at a moment, which is the only question
    // either rasteriser asks of the plan.
    const drawnAt = (at: number) => {
      const item = items.find((candidate) => cursorAt(candidate.points, at) !== null);
      if (item?.kind !== "cursor") throw new Error(`nothing drawn at ${at}`);
      return item.path;
    };

    expect(drawnAt(500_000_000)).toBe("arrow.png");
    expect(drawnAt(1_500_000_000)).toBe("hand.png");
    // The shape holds until the sample that says otherwise, so the hand is
    // still on at 2.5s and gone by 3s. That is the data, not a rounding: the
    // capture side writes a sample the moment the shape changes, so the sample
    // that ends a hover *is* when it ended.
    expect(drawnAt(2_500_000_000)).toBe("hand.png");
    expect(drawnAt(3_000_000_000)).toBe("arrow.png");
  });

  it("gives the hand its own hotspot", () => {
    // An arrow points with its tip and a hand with its fingertip. One hotspot
    // for both puts whichever it was not written for beside what it is on.
    const hand = itemsFor(HOVER).find((item) => item.kind === "cursor" && item.path === "hand.png");
    if (hand?.kind !== "cursor") throw new Error("no hand item");

    expect(hand.hotspot).toEqual({ x: 0.3754, y: 0.055 });
  });

  it("stays one item for a recording that never showed a hand", () => {
    // Every take made before the shape was sampled. A second item would be a
    // second texture to load and a second quad to draw for nothing at all.
    expect(itemsFor([{ at: 0, x: 0.2, y: 0.2 }])).toHaveLength(1);
  });

  it("stays one item for a style with no other shape to swap to", () => {
    const items = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings(),
      { ...TONE, shapes: { arrow: TONE.shapes.arrow }, samples: HOVER },
    ).items.filter((item) => item.kind === "cursor");

    expect(items).toHaveLength(1);
  });

  it("draws the I-beam for the span the system showed one", () => {
    // The whole point of a pointer per kind. An arrow parked in a text field
    // while somebody types is the tell that the pointer was drawn in
    // afterwards, and it is the one nobody can unsee.
    const items = itemsFor([
      { at: 0, x: 0.2, y: 0.2 },
      { at: 1_000_000_000, x: 0.4, y: 0.4, kind: "text" },
      { at: 2_000_000_000, x: 0.6, y: 0.6 },
    ]);

    const drawnAt = (at: number) => {
      const item = items.find((candidate) => cursorAt(candidate.points, at) !== null);
      if (item?.kind !== "cursor") throw new Error(`nothing drawn at ${at}`);
      return item.path;
    };

    expect(drawnAt(500_000_000)).toBe("arrow.png");
    expect(drawnAt(1_500_000_000)).toBe("text.png");
    expect(drawnAt(2_000_000_000)).toBe("arrow.png");
  });

  it("draws exactly one pointer at every moment of three kinds in one take", () => {
    // The handover is between *images*, not between an arrow and one other
    // thing. Three tracks share the timeline and the same rule has to hold
    // across all of them: never a blink, never two pointers.
    const items = itemsFor([
      { at: 0, x: 0.2, y: 0.2 },
      { at: 1_000_000_000, x: 0.3, y: 0.3, kind: "hand" },
      { at: 2_000_000_000, x: 0.4, y: 0.4, kind: "text" },
      { at: 3_000_000_000, x: 0.5, y: 0.5 },
    ]);

    expect(items).toHaveLength(3);

    for (let at = 0; at <= 3_000_000_000; at += 10_000_000) {
      const drawn = items.filter(
        (item) => item.kind === "cursor" && cursorAt(item.points, at) !== null,
      );

      expect(drawn, `at ${at}`).toHaveLength(1);
    }
  });

  it("draws the arrow for a kind the style has no image for", () => {
    // A style ships what it ships. Emitting an item for a texture that is not
    // there would draw nothing at all over a text field — worse than an arrow,
    // because the pointer would vanish rather than be slightly wrong.
    const items = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings(),
      {
        ...TONE,
        shapes: { arrow: TONE.shapes.arrow },
        samples: [
          { at: 0, x: 0.2, y: 0.2 },
          { at: 1_000_000_000, x: 0.4, y: 0.4, kind: "text" as const },
        ],
      },
    ).items.filter((item) => item.kind === "cursor");

    expect(items).toHaveLength(1);
    expect(items[0]!.kind === "cursor" && items[0]!.path).toBe("arrow.png");
  });

  it("still reads the hand off a recording made before kinds", () => {
    // Every take on disk today says `hand: true` and carries no `kind` at all.
    // Dropping the fallback would not break anything visibly — it would just
    // quietly stop drawing the hand on every recording anybody already has.
    const items = itemsFor([
      { at: 0, x: 0.2, y: 0.2 },
      { at: 1_000_000_000, x: 0.4, y: 0.4, hand: true },
    ]);

    const drawn = items.find((item) => cursorAt(item.points, 1_500_000_000) !== null);
    expect(drawn?.kind === "cursor" && drawn.path).toBe("hand.png");
  });

  it("prefers the kind over the boolean where a sample has both", () => {
    // A recording written by a build that carried both. The kind is the newer
    // and more specific of the two, and reading them the other way round would
    // draw a hand in a text field.
    const items = itemsFor([
      { at: 0, x: 0.2, y: 0.2 },
      { at: 1_000_000_000, x: 0.4, y: 0.4, kind: "text", hand: true },
    ]);

    const drawn = items.find((item) => cursorAt(item.points, 1_500_000_000) !== null);
    expect(drawn?.kind === "cursor" && drawn.path).toBe("text.png");
  });

  it("keeps every point in time order through the handover", () => {
    // `cursorAt` binary-searches these. One point out of order and it reads
    // back the wrong span, which draws a pointer somewhere it never was.
    for (const item of itemsFor(HOVER)) {
      if (item.kind !== "cursor") continue;
      const times = item.points.map((point) => point.at);

      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });
});

describe("hiding a parked pointer", () => {
  const still = {
    shapes: { arrow: { path: "cursor.png", hotspot: { x: 0.055, y: 0.055 } } },
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
      // Unsmoothed, so "left alone" can be read straight off the count: the
      // smoothing writes the path at the output cadence and a point is then no
      // longer a sample.
      unsmoothed(),
      { ...still, hideAfter: null },
    ).items.find((candidate) => candidate.kind === "cursor")!;
    if (item.kind !== "cursor") throw new Error("wrong item");

    expect(item.points).toHaveLength(still.samples.length);
    expect(cursorAt(item.points, 20_000_000_000)).not.toBeNull();
  });
});

describe("smoothing the pointer's path", () => {
  const SHAPES = { arrow: { path: "cursor.png", hotspot: { x: 0.055, y: 0.055 } } };

  /** The pointer's screen position over time, read the way a rasteriser reads it. */
  const drawn = (
    samples: { at: number; x: number; y: number }[],
    smoothing: number,
    hideAfter: number | null = null,
  ) => {
    const item = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings({ layout: { ...DEFAULT_SETTINGS.layout, cursorSmoothing: smoothing } }),
      { shapes: SHAPES, size: 0.035, hideAfter, samples },
    ).items.find((candidate) => candidate.kind === "cursor")!;
    if (item.kind !== "cursor") throw new Error("wrong item");
    return item;
  };

  /** A hand crossing the screen and turning back, sampled at the rate the capture manages. */
  const ZIGZAG = Array.from({ length: 30 }, (_, step) => ({
    at: step * 33_000_000,
    x: 0.3 + (step % 6 < 3 ? step % 6 : 6 - (step % 6)) * 0.06,
    y: 0.4 + (step % 4 < 2 ? step % 4 : 4 - (step % 4)) * 0.05,
  }));

  /** The largest change in velocity between two output frames, in pixels. */
  const worstKink = (item: ReturnType<typeof drawn>) => {
    const frame = 16_666_666;
    const at = (step: number) => cursorAt(item.points, step * frame);
    let worst = 0;

    for (let step = 2; step * frame <= ZIGZAG[ZIGZAG.length - 1]!.at; step += 1) {
      const [a, b, c] = [at(step - 2), at(step - 1), at(step)];
      if (!a || !b || !c) continue;
      worst = Math.max(worst, Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y));
    }

    return worst;
  };

  it("takes the corners out of a path sampled slower than the frame rate", () => {
    // The failure the control exists for. Drawn as sampled, every one of those
    // turns lands inside a single frame and the pointer changes direction in
    // one step; that step is the stepping people see. Deliberately a harder
    // path than a hand makes — it turns every hundred milliseconds, which is
    // most of what the smoothing can reach — so the margin here is the floor
    // rather than what an ordinary move gets.
    expect(worstKink(drawn(ZIGZAG, 0.4))).toBeLessThan(worstKink(drawn(ZIGZAG, 0)) / 3);
  });

  it("draws the samples as they were taken when it is off", () => {
    const item = drawn(ZIGZAG, 0);
    expect(item.points.map((point) => point.at)).toEqual(ZIGZAG.map((sample) => sample.at));
  });

  it("arrives where the pointer actually went", () => {
    // A smoothed path that settles anywhere else is a pointer that misses what
    // it was pointing at, which is worse than the stepping it was fixing.
    const straight = drawn(ZIGZAG, 1);
    const raw = drawn(ZIGZAG, 0);
    const last = ZIGZAG[ZIGZAG.length - 1]!.at;

    const settled = cursorAt(straight.points, last + 2_000_000_000)!;
    const stopped = cursorAt(raw.points, last)!;

    // Inside a pixel of it, at the strength that lags furthest.
    expect(Math.hypot(settled.x - stopped.x, settled.y - stopped.y)).toBeLessThan(1);
  });

  it("leaves a parked pointer's gap in the track for the auto-hide to find", () => {
    // The smoothing writes points at the output cadence, and filling in a gap
    // this way would quietly switch off "hide when still" — the gap is the only
    // record that the pointer was parked at all.
    const parked = [
      { at: 0, x: 0.2, y: 0.2 },
      { at: 33_000_000, x: 0.3, y: 0.3 },
      { at: 10_000_000_000, x: 0.301, y: 0.301 },
    ];
    const item = drawn(parked, 1, 2);

    expect(cursorAt(item.points, 1_000_000_000)).not.toBeNull();
    expect(cursorAt(item.points, 5_000_000_000)).toBeNull();
  });

  it("keeps its points in order at every strength", () => {
    // `cursorAt` binary-searches them, and one point out of order reads as a
    // pointer that jumps back for a frame.
    for (const smoothing of [0, 0.2, 0.5, 1]) {
      const times = drawn(ZIGZAG, smoothing).points.map((point) => point.at);
      expect(times, `at ${smoothing}`).toEqual([...times].sort((a, b) => a - b));
    }
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
    // Both pictures, now: the camera reaches its crop through the same fitter
    // the screen does, and in an arrangement that hands it a tall column there
    // is nothing about a webcam's own proportions to fall back on.
    for (const frame of FRAMES) {
      for (const source of SOURCES) {
        for (const preset of PRESETS) {
          for (const zoom of [0.05, 0.25, 0.5, 0.9, 1, 1.5, 3]) {
            const plan = buildRenderPlan(
              frame,
              { screen: source, camera: CAMERA },
              settings({
                layout: { ...settings().layout, preset, screenZoom: zoom, cameraZoom: zoom },
              }),
            );

            for (const which of ["screen", "camera"] as const) {
              const item = image(plan, which);
              if (!item) continue;

              const where = `${frame.width}x${frame.height} ${preset} ${which} @${zoom}`;
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
    }
  });

  it("never samples outside either recording, in any arrangement", () => {
    for (const frame of FRAMES) {
      for (const preset of PRESETS) {
        const plan = buildRenderPlan(
          frame,
          { screen: SCREEN, camera: CAMERA },
          settings({
            layout: {
              ...settings().layout,
              preset,
              screenOffsetX: 0.4,
              screenOffsetY: -0.4,
              cameraOffsetX: -0.6,
              cameraOffsetY: 0.6,
            },
          }),
        );

        for (const [which, source] of [
          ["screen", SCREEN],
          ["camera", CAMERA],
        ] as const) {
          const item = image(plan, which);
          if (!item) continue;

          const where = `${frame.width}x${frame.height} ${preset} ${which}`;
          expect(item.srcRect.x, where).toBeGreaterThanOrEqual(0);
          expect(item.srcRect.y, where).toBeGreaterThanOrEqual(0);
          expect(item.srcRect.x + item.srcRect.width, where).toBeLessThanOrEqual(
            source.width + 1e-6,
          );
          expect(item.srcRect.y + item.srcRect.height, where).toBeLessThanOrEqual(
            source.height + 1e-6,
          );
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
              preset: "over-full",
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
      settings({ layout: { ...settings().layout, preset: "over-full", screenZoom: 0.5 } }),
    );
    const { dstRect } = image(plan, "screen")!;

    expect(dstRect.width).toBeLessThan(frame.width);
    // Still centred in what it was given.
    expect(dstRect.x + dstRect.width / 2).toBeCloseTo(frame.width / 2);
    expect(dstRect.y + dstRect.height / 2).toBeCloseTo(frame.height / 2);
  });
});

describe("filling the frame", () => {
  const shot = (preset: "over-padded" | "over-full", padding: number) =>
    buildRenderPlan(
      LANDSCAPE,
      { screen: SCREEN, camera: null },
      settings({
        layout: { ...DEFAULT_SETTINGS.layout, preset },
        background: { ...DEFAULT_SETTINGS.background, padding },
      }),
    );

  it("crops nothing from a recording already the shape of the frame", () => {
    // The bug this pins. Padding is a fraction of the frame's *shorter* edge
    // taken off all four sides, so the box it leaves is always wider than the
    // frame — and filling that box cropped a 16:9 recording in a 16:9 frame to
    // a shape nothing was ever recorded in. Six per cent of the picture, spent
    // on nothing.
    const { srcRect } = image(shot("over-full", 0.06), "screen")!;

    expect(srcRect).toEqual({ x: 0, y: 0, width: SCREEN.width, height: SCREEN.height });
  });

  it("actually reaches the edges", () => {
    // And it did not even fill what it cropped for: the picture stopped at the
    // padding, so "Fill" left a border on all four sides.
    const { dstRect } = image(shot("over-full", 0.06), "screen")!;

    expect(dstRect).toEqual({ x: 0, y: 0, width: LANDSCAPE.width, height: LANDSCAPE.height });
  });

  it("is the same picture whatever the padding says", () => {
    // The two settings answer the same question, and `cover` answers it "no
    // gaps". There is no room left for padding to ask for.
    expect(image(shot("over-full", 0.2), "screen")).toEqual(image(shot("over-full", 0), "screen"));
  });

  it("still leaves room around a picture that is contained", () => {
    // The other half of it: padding is what `contain` is for, and this must not
    // have quietly turned it off for everyone.
    const { dstRect } = image(shot("over-padded", 0.06), "screen")!;

    expect(dstRect.x).toBeGreaterThan(0);
    expect(dstRect.width).toBeLessThan(LANDSCAPE.width);
  });
});

describe("an edit made before layouts existed", () => {
  // The numbers the old code produced for the default look, worked out by hand
  // against it and pinned here.
  //
  // Every project on disk is one of these: Fit, a padded card, a squircle
  // bubble in the bottom right. The camera reaches its crop through a general
  // fitter now rather than through a centre-square and a tighten, and the whole
  // claim of the migration is that this changes nothing anyone can see. If this
  // fails, every existing edit opens looking different from the day it was
  // saved — and it would be noticed on export rather than here.
  const plan = buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: CAMERA }, DEFAULT_SETTINGS);

  it("puts the screen exactly where it always did", () => {
    const { dstRect, srcRect } = image(plan, "screen")!;

    // 6% of 1080 off each side, then the whole 16:9 source contained in what is
    // left — height-constrained, so it fills the padded box top to bottom.
    expect(dstRect.x).toBeCloseTo(115.2, 6);
    expect(dstRect.y).toBeCloseTo(64.8, 6);
    expect(dstRect.width).toBeCloseTo(1689.6, 6);
    expect(dstRect.height).toBeCloseTo(950.4, 6);
    expect(srcRect).toEqual({ x: 0, y: 0, width: SCREEN.width, height: SCREEN.height });
  });

  it("puts the bubble exactly where it always did, cropped the same way", () => {
    const { dstRect, srcRect } = image(plan, "camera")!;

    expect(dstRect.x).toBeCloseTo(1481.4, 6);
    expect(dstRect.y).toBeCloseTo(642.6, 6);
    expect(dstRect.width).toBeCloseTo(378, 6);
    expect(dstRect.height).toBeCloseTo(378, 6);

    // The centre square of a 1280×720 camera — what `centreSquare` used to
    // return, now what fitting a square box under `cover` arrives at.
    expect(srcRect.x).toBeCloseTo(280, 6);
    expect(srcRect.y).toBeCloseTo(0, 6);
    expect(srcRect.width).toBeCloseTo(720, 6);
    expect(srcRect.height).toBeCloseTo(720, 6);
  });
});

describe("the arrangements", () => {
  const boxes = (preset: LayoutPreset, frame: Size = LANDSCAPE) =>
    layoutBoxes(frame, { ...DEFAULT_SETTINGS.layout, preset }, DEFAULT_SETTINGS.background, {
      screen: SCREEN,
      camera: CAMERA,
    });

  const overlap = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

  it("matches the camera to the screen's height, beside it", () => {
    // The point of `beside`: one row, two pictures, and a webcam cropped into a
    // portrait column rather than shrunk to a postage stamp beside a 16:9 card.
    const { screen, camera } = boxes("beside");

    expect(camera!.area.height).toBeCloseTo(screen!.area.height);
    expect(camera!.area.y).toBeCloseTo(screen!.area.y);
    expect(camera!.area.x).toBeGreaterThan(screen!.area.x + screen!.area.width - 0.001);
    expect(overlap(screen!.area, camera!.area)).toBeCloseTo(0);
  });

  it("matches the camera to the screen's width, under it", () => {
    const { screen, camera } = boxes("stacked");

    expect(camera!.area.width).toBeCloseTo(screen!.area.width);
    expect(camera!.area.x).toBeCloseTo(screen!.area.x);
    expect(camera!.area.y).toBeGreaterThan(screen!.area.y + screen!.area.height - 0.001);
    expect(overlap(screen!.area, camera!.area)).toBeCloseTo(0);
  });

  it("never leaves the camera a slit, whatever the recording's shape", () => {
    // The bug this pins. Matching the screen's height decides the camera's
    // height, so what is left over is a *width* — and beside a 16:9 recording
    // at full height there is almost none of it. A camera 0.39 wide per unit
    // tall is a nose.
    for (const screen of [
      { width: 2560, height: 1440 },
      { width: 5120, height: 1440 },
      { width: 1600, height: 1600 },
      { width: 1440, height: 2560 },
    ]) {
      for (const frame of [LANDSCAPE, VERTICAL, { width: 1080, height: 1080 }]) {
        const beside = layoutBoxes(
          frame,
          { ...DEFAULT_SETTINGS.layout, preset: "beside" },
          DEFAULT_SETTINGS.background,
          { screen, camera: CAMERA },
        );
        const where = `${screen.width}x${screen.height} in ${frame.width}x${frame.height}`;
        const column = beside.camera!.area;

        expect(column.width, where).toBeGreaterThan(0);
        expect(column.width / column.height, where).toBeGreaterThanOrEqual(2 / 3 - 1e-6);
        expect(column.height, where).toBeCloseTo(beside.screen!.area.height);
        expect(overlap(beside.screen!.area, column), where).toBeCloseTo(0);

        const stacked = layoutBoxes(
          frame,
          { ...DEFAULT_SETTINGS.layout, preset: "stacked" },
          DEFAULT_SETTINGS.background,
          { screen, camera: CAMERA },
        );
        const row = stacked.camera!.area;

        expect(row.height, where).toBeGreaterThan(0);
        expect(row.width / row.height, where).toBeLessThanOrEqual(2 + 1e-6);
        expect(row.width, where).toBeCloseTo(stacked.screen!.area.width);
        expect(overlap(stacked.screen!.area, row), where).toBeCloseTo(0);
      }
    }
  });

  it("still leaves the screen the prominent one beside a wide recording", () => {
    // The camera getting a usable shape must not have quietly turned `beside`
    // into an even split — the screen is what is being demonstrated.
    const { screen, camera } = boxes("beside");

    expect(screen!.area.width).toBeGreaterThan(camera!.area.width * 2);
  });

  it("gives each picture exactly half of a split", () => {
    for (const preset of ["split", "split-stacked"] as const) {
      const { screen, camera } = boxes(preset);

      expect(screen!.area.width, preset).toBeCloseTo(camera!.area.width);
      expect(screen!.area.height, preset).toBeCloseTo(camera!.area.height);
      expect(overlap(screen!.area, camera!.area), preset).toBeCloseTo(0);
    }
  });

  it("leaves out the picture its name leaves out", () => {
    // Whatever the toggle says. In `camera-*` the arrangement *is* how the
    // camera is turned on, so a stale toggle must not empty the frame.
    const on = { ...DEFAULT_SETTINGS.layout, cameraVisible: true };
    const off = { ...DEFAULT_SETTINGS.layout, cameraVisible: false };
    const sources = { screen: SCREEN, camera: CAMERA };
    const at = (layout: typeof on, preset: LayoutPreset) =>
      layoutBoxes(LANDSCAPE, { ...layout, preset }, DEFAULT_SETTINGS.background, sources);

    for (const layout of [on, off]) {
      expect(at(layout, "screen-full").camera).toBeNull();
      expect(at(layout, "screen-padded").camera).toBeNull();
      expect(at(layout, "camera-full").screen).toBeNull();
      expect(at(layout, "camera-padded").screen).toBeNull();
      expect(at(layout, "camera-full").camera).not.toBeNull();
    }
  });

  it("keeps every box inside the frame, whatever shape the frame is", () => {
    for (const frame of [LANDSCAPE, VERTICAL, { width: 1080, height: 1080 }]) {
      for (const preset of PRESETS) {
        const { screen, camera } = boxes(preset, frame);

        for (const [which, slot] of [
          ["screen", screen],
          ["camera", camera],
        ] as const) {
          if (!slot) continue;

          const where = `${preset} ${which} in ${frame.width}x${frame.height}`;
          expect(slot.area.x, where).toBeGreaterThanOrEqual(-1e-6);
          expect(slot.area.y, where).toBeGreaterThanOrEqual(-1e-6);
          expect(slot.area.x + slot.area.width, where).toBeLessThanOrEqual(frame.width + 1e-6);
          expect(slot.area.y + slot.area.height, where).toBeLessThanOrEqual(frame.height + 1e-6);
        }
      }
    }
  });

  it("pulls a box dragged past the edge back inside", () => {
    const off = layoutBoxes(
      LANDSCAPE,
      {
        ...DEFAULT_SETTINGS.layout,
        preset: "custom",
        screenX: 4,
        screenY: -3,
        screenWidth: 0.5,
        screenHeight: 0.5,
      },
      DEFAULT_SETTINGS.background,
      { screen: SCREEN, camera: CAMERA },
    );

    expect(off.screen!.area.x + off.screen!.area.width).toBeLessThanOrEqual(1920 + 1e-6);
    expect(off.screen!.area.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it("gives the camera its own shape in every arrangement", () => {
    // The frame belongs to the screen recording. A card beside the screen used
    // to take the screen's corner radius, which meant the Frame panel reshaped
    // the camera — so rounding the screen's corners rounded somebody's face.
    const radius = (preset: LayoutPreset) => {
      const plan = buildRenderPlan(
        LANDSCAPE,
        { screen: SCREEN, camera: CAMERA },
        settings({ layout: { ...DEFAULT_SETTINGS.layout, preset, cameraShape: "circle" } }),
      );
      return {
        screen: image(plan, "screen")?.shape,
        camera: image(plan, "camera")!.shape,
      };
    };

    // A circle is a circle whether it stands beside the screen or floats over
    // it: half the shorter edge of the box it is in, never the screen's radius.
    const slotted = radius("split");
    const card = image(
      buildRenderPlan(
        LANDSCAPE,
        { screen: SCREEN, camera: CAMERA },
        settings({
          layout: { ...DEFAULT_SETTINGS.layout, preset: "split", cameraShape: "circle" },
        }),
      ),
      "camera",
    )!;
    expect(slotted.camera.radius).toBeCloseTo(
      Math.min(card.dstRect.width, card.dstRect.height) / 2,
    );
    expect(slotted.camera.radius).not.toBeCloseTo(slotted.screen!.radius);

    const floating = radius("over-padded");
    const bubble = image(
      buildRenderPlan(
        LANDSCAPE,
        { screen: SCREEN, camera: CAMERA },
        settings({ layout: { ...DEFAULT_SETTINGS.layout, cameraShape: "circle" } }),
      ),
      "camera",
    )!;
    // Half its shorter edge: a circle, and nothing like the card's radius.
    expect(floating.camera.radius).toBeCloseTo(
      Math.min(bubble.dstRect.width, bubble.dstRect.height) / 2,
    );
    expect(floating.camera.radius).not.toBeCloseTo(floating.screen!.radius);
  });

  it("keeps the camera's corners when only the screen is dragged", () => {
    // The bug this pins. `custom` dressed the camera as a bubble whatever it
    // was reached from, so dragging the screen out of a split turned the card
    // standing beside it into a circle — a change to the picture the user was
    // not touching, on the gesture where they are watching the other one.
    const shapeOf = (layout: Partial<LayoutSettings>) =>
      image(
        buildRenderPlan(
          LANDSCAPE,
          { screen: SCREEN, camera: CAMERA },
          settings({ layout: { ...DEFAULT_SETTINGS.layout, ...layout } }),
        ),
        "camera",
      )!.shape;

    // What the preview seeds when a drag detaches: the boxes as they were, and
    // the dressing they had.
    const split = layoutBoxes(
      LANDSCAPE,
      { ...DEFAULT_SETTINGS.layout, preset: "split" },
      DEFAULT_SETTINGS.background,
      { screen: SCREEN, camera: CAMERA },
    );
    const box = split.camera!.area;
    const unit = Math.min(LANDSCAPE.width, LANDSCAPE.height);
    const dragged: Partial<LayoutSettings> = {
      preset: "custom",
      cameraCard: split.camera!.card,
      cameraX: (box.x + box.width / 2) / LANDSCAPE.width,
      cameraY: (box.y + box.height / 2) / LANDSCAPE.height,
      cameraWidth: box.width / unit,
      cameraHeight: box.height / unit,
    };

    expect(shapeOf(dragged)).toEqual(shapeOf({ preset: "split" }));

    // And the other direction still holds: a bubble dragged out of `over-*`
    // must not square off either.
    expect(shapeOf({ preset: "custom", cameraCard: false })).toEqual(
      shapeOf({ preset: "over-padded" }),
    );
  });

  it("puts the border round the screen only, in every arrangement", () => {
    // One stroke, always the screen's. A stroke round the camera is a ring
    // drawn on somebody's face, which is not what a border slider promises.
    const strokes = (preset: LayoutPreset) =>
      buildRenderPlan(
        LANDSCAPE,
        { screen: SCREEN, camera: CAMERA },
        settings({
          layout: { ...DEFAULT_SETTINGS.layout, preset },
          background: { ...DEFAULT_SETTINGS.background, borderWidth: 0.01 },
        }),
      ).items.filter((item) => item.kind === "stroke").length;

    expect(strokes("split")).toBe(1);
    expect(strokes("over-padded")).toBe(1);
    expect(strokes("camera-padded")).toBe(0);
  });
});

describe("the shadow", () => {
  const shadowOf = (plan: RenderPlan) => {
    const item = plan.items.find((candidate) => candidate.kind === "shadow");
    if (item?.kind !== "shadow") throw new Error("no shadow");
    return item;
  };

  const plan = (zooms: ZoomSlice[] = []) =>
    buildRenderPlan(LANDSCAPE, { screen: SCREEN, camera: null }, settings(), null, zooms);

  it("is given room past the shape that casts it", () => {
    // The bug: a shadow was rasterised only as far as the picture's own
    // rectangle, and everything inside that rectangle is hidden under the
    // picture. So the only visible part was the last sliver before the geometry
    // ran out — half opacity, ending on a hard line. It read as a slab of paint
    // rather than as light, and no amount of blur could fix it, because the
    // blur had nowhere to go.
    const shadow = shadowOf(plan());
    const { dstRect } = image(plan(), "screen")!;
    const bleed = (shadow.blur / 2) * SHADOW_SPREAD;

    expect(shadow.rect.x).toBeCloseTo(dstRect.x - bleed, 6);
    expect(shadow.rect.y).toBeCloseTo(dstRect.y - bleed, 6);
    expect(shadow.rect.width).toBeCloseTo(dstRect.width + bleed * 2, 6);
    expect(shadow.rect.height).toBeCloseTo(dstRect.height + bleed * 2, 6);
  });

  it("keeps that room through a zoom", () => {
    // The shadow has a track of its own rather than sharing the picture's,
    // because a tilted picture's corners are a projection and there is no way
    // to grow four projected corners by a distance in pixels afterwards. A
    // shared track would have put the bleed back to zero the moment a zoom
    // started, which is exactly when a shadow is most visible.
    const zooms: ZoomSlice[] = [
      { ...DEFAULT_ZOOM, id: "z", source: { start: 0, end: 4 * 1_000_000_000 }, level: 2 },
    ];
    const shadow = shadowOf(plan(zooms));
    const picture = image(plan(zooms), "screen")!;
    const bleed = (shadow.blur / 2) * SHADOW_SPREAD;

    expect(shadow.motion).toBeDefined();
    expect(shadow.motion).toHaveLength(picture.motion!.length);

    for (const [index, key] of shadow.motion!.entries()) {
      const under = picture.motion![index]!;
      expect(key.width).toBeCloseTo(under.width + bleed * 2, 6);
      expect(key.x).toBeCloseTo(under.x - bleed, 6);
    }
  });

  it("keeps the picture's own corner radius", () => {
    // What is being drawn is the silhouette; the bleed is only somewhere to
    // draw it. Rounding the grown rectangle instead would round a shape three
    // blur radii too big and leave the shadow the wrong shape at every corner.
    expect(shadowOf(plan()).shape.radius).toBe(image(plan(), "screen")!.shape.radius);
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
    rotateX: 0,
    rotateY: 0,
    perspective: 0.5,
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

  /** The key at the deepest point of the move, where the shot has fully arrived. */
  const deepest = (zooms: ZoomSlice[]) => {
    const { keys } = motionOf(zooms);
    return keys.reduce((best, key) => (key.width > best.width ? key : best), keys[0]!);
  };

  describe("what the shot is looking at", () => {
    /**
     * The sharp patch has to be where the subject is, not where the frame is.
     *
     * It used to be hard-coded to the middle of the frame, which is only where
     * the subject ends up when the picture had room to carry it there. Aiming
     * at anything near an edge left the blur focused on empty space — and
     * because it *looked* like a working depth of field, nothing about it read
     * as broken.
     */
    it("puts the sharp patch on the target, not on the middle of the frame", () => {
      const left = deepest([region({ x: 0.15, y: 0.5, blur: true })]);
      const right = deepest([region({ x: 0.85, y: 0.5, blur: true })]);

      expect(left.focus).toBeDefined();
      expect(right.focus).toBeDefined();

      // Aiming at opposite sides has to move it to opposite sides.
      expect(left.focus!.x).toBeLessThan(FRAME.width / 2);
      expect(right.focus!.x).toBeGreaterThan(FRAME.width / 2);
    });

    it("carries the sharp patch along with the move rather than after it", () => {
      const { keys } = motionOf([region({ x: 0.9, y: 0.5, blur: true })]);
      const withFocus = keys.filter((key) => key.focus);

      // Every key in the move, not just the ends: a patch that jumped to its
      // final place on the first frame would pass the test above and still be
      // wrong for the whole of the travel.
      const xs = withFocus.map((key) => key.focus!.x);
      expect(new Set(xs).size).toBeGreaterThan(1);
    });

    it("leaves it out entirely when the zoom has no blur", () => {
      // Carrying a focus nothing reads would put the depth of field in every
      // plan twice over.
      expect(deepest([region({ blur: false })]).focus).toBeUndefined();
    });
  });

  describe("a target near an edge", () => {
    /**
     * A corner cannot be centred without sliding half the picture off the frame,
     * so the camera used to give up and not move at all — which is why aiming a
     * zoom at a corner appeared to do nothing.
     */
    it("still travels toward it", () => {
      const { base } = motionOf([]);
      const corner = deepest([region({ x: 0.02, y: 0.02 })]);

      // The old behaviour pinned the picture's own edge to the base rectangle's.
      // Anything past that is travel the shot could not previously make.
      expect(corner.x).toBeGreaterThan(base.x);
      expect(corner.y).toBeGreaterThan(base.y);
    });

    it("brings a corner a third of the way to the middle", () => {
      const { base } = motionOf([]);
      const corner = deepest([region({ x: 0, y: 0, blur: true })]);

      // Where the corner sits un-zoomed, and where it ends up.
      const rest = base.x;
      const landed = corner.focus!.x;
      const middle = FRAME.width / 2;

      const travelled = (landed - rest) / (middle - rest);

      // `EDGE_REACH` is a third. Enough that the move is unmistakably going
      // somewhere; not so much that the picture slides off the frame.
      expect(travelled).toBeGreaterThan(0.3);
      expect(travelled).toBeLessThan(0.45);
    });

    it("does not travel so far that it uncovers the frame", () => {
      const { base } = motionOf([]);
      const corner = deepest([region({ x: 0, y: 0 })]);

      // `EDGE_REACH` is a third of the way, so the picture keeps two thirds of
      // the overlap it would have had. Centring the corner outright is the
      // failure this guards: it would leave half the frame showing background.
      const uncovered = corner.x - base.x;
      expect(uncovered).toBeLessThan(FRAME.width / 4);
    });

    it("leaves an interior target exactly where it was", () => {
      // The blend is between two numbers that are equal wherever the picture had
      // room, so nothing about an ordinary zoom may shift.
      const middle = deepest([region({ x: 0.5, y: 0.5 })]);

      expect(middle.x).toBeCloseTo(FRAME.width / 2 - middle.width / 2, 5);
      expect(middle.y).toBeCloseTo(FRAME.height / 2 - middle.height / 2, 5);
    });
  });

  it("leaves the plan alone when there is nothing to zoom", () => {
    // No keys at all, rather than a flat track of the base rectangle for the
    // whole recording — which for a ten-minute take would be 18,000 of them.
    expect(motionOf([]).keys).toHaveLength(0);
  });

  it("opens and closes on the un-zoomed rectangle, outside the slice", () => {
    // What makes the gaps between zooms free: interpolating base to base is
    // base, so the flat stretches need no keys of their own.
    //
    // Half a second either side of the slice rather than at its edges: the
    // moves live outside it, so the track starts where the picture sets off and
    // ends where it has settled back.
    const { keys, base } = motionOf([region()]);

    expect(keys[0]).toMatchObject({ at: 2 * S - S / 2, ...base });
    expect(keys[keys.length - 1]).toMatchObject({ at: 6 * S + S / 2, ...base });
  });

  it("is fully in for the whole of its slice", () => {
    // The point of the change: a two second slice at 0.5s speed used to be in
    // close for one second of it. Both edges of the slice are now the deepest
    // the shot ever gets, and everything between them is that too.
    const { keys, base, radius } = motionOf([region()]);

    for (const at of [2 * S, 3 * S, 4 * S, 5 * S, 6 * S]) {
      expect(rectAt(keys, at, base, radius).width).toBeCloseTo(base.width * 2, 3);
    }
  });

  it("eases into the slice rather than starting from it", () => {
    // Halfway through the move in, the picture is on its way and has not
    // arrived — and the move is over by the time the slice begins.
    const { keys, base, radius } = motionOf([region()]);
    const halfway = rectAt(keys, 2 * S - S / 4, base, radius);

    expect(halfway.width).toBeGreaterThan(base.width);
    expect(halfway.width).toBeLessThan(base.width * 2);
  });

  it("starts already in close when there is no room to travel", () => {
    // A zoom on the opening frame has nothing to move away from: the move in
    // reaches back as far as the start of the recording and no further, which
    // for a zoom at zero is not at all. Being in close from the first frame is
    // right — there is no earlier frame for it to differ from.
    const { keys, base, radius } = motionOf([region({ source: { start: 0, end: 3 * S } })]);

    expect(rectAt(keys, 0, base, radius).width).toBeCloseTo(base.width * 2, 3);
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

  it("comes off the area it filled by a bounded amount, and only at the leading edge", () => {
    // This used to assert the picture *never* came off that area, and it was a
    // fair rule until it turned out to be the reason aiming a zoom at a corner
    // did nothing: covering the area from a corner is impossible, so the camera
    // stayed put. `EDGE_REACH` buys the move at the price of some background
    // showing on the side the shot is travelling away from.
    //
    // The bound is what is still worth pinning. Uncapped, this is a zoom that
    // slides the recording halfway out of frame.
    const { keys, base } = motionOf([region({ x: 0, y: 0, level: 4 })]);

    for (const key of keys) {
      // The trailing edges still cover: a shot moving up-left cannot uncover
      // the bottom or the right, and if it ever does the sign is wrong somewhere.
      expect(key.x + key.width).toBeGreaterThanOrEqual(base.x + base.width - 1e-6);
      expect(key.y + key.height).toBeGreaterThanOrEqual(base.y + base.height - 1e-6);

      // The leading edges may come inside, by well under a fifth of the frame.
      expect(key.x - base.x).toBeLessThan(FRAME.width * 0.2);
      expect(key.y - base.y).toBeLessThan(FRAME.height * 0.2);
    }
  });

  describe("the camera getting out of the way", () => {
    /**
     * A zoom brings the picture closer and the bubble does not move, so it ends
     * up covering more of a frame with less room in it. These pin that it
     * shrinks with the move, and only where shrinking makes sense.
     */
    const withCamera = (over: Partial<SliceSettings["layout"]> = {}) =>
      settings({ layout: { ...DEFAULT_SETTINGS.layout, preset: "over-padded", ...over } });

    const cameraOf = (zooms: ZoomSlice[], over: Partial<SliceSettings["layout"]> = {}) => {
      const plan = buildRenderPlan(
        FRAME,
        { screen: SCREEN, camera: CAMERA },
        withCamera(over),
        null,
        zooms,
      );
      const item = plan.items.find(
        (candidate) => candidate.kind === "image" && candidate.source === "camera",
      )!;
      if (item.kind !== "image") throw new Error("wrong item");
      return { keys: item.motion ?? [], base: item.dstRect, radius: item.shape.radius };
    };

    it("shrinks to the size it was asked for while a zoom is held", () => {
      const { keys, base, radius } = cameraOf([region()]);

      expect(rectAt(keys, 4 * S, base, radius).width).toBeCloseTo(base.width * 0.7, 3);
      expect(rectAt(keys, 4 * S, base, radius).height).toBeCloseTo(base.height * 0.7, 3);
    });

    it("is back to full size between two zooms that are far apart", () => {
      const { keys, base, radius } = cameraOf([
        region({ id: "a", source: { start: 2 * S, end: 3 * S } }),
        region({ id: "b", source: { start: 7 * S, end: 8 * S } }),
      ]);

      expect(rectAt(keys, 5 * S, base, radius).width).toBeCloseTo(base.width, 3);
    });

    it("stays out of the way across a join between two zooms", () => {
      // The same property the picture's own keys have there: two zooms back to
      // back never return to rest, so neither may the bubble — a camera that
      // sprang back to full size at the boundary and shrank again would be the
      // flinch the morph exists to remove.
      const { keys, base, radius } = cameraOf([
        region({ id: "a", source: { start: 2 * S, end: 4 * S }, x: 0.25 }),
        region({ id: "b", source: { start: 4 * S, end: 6 * S }, x: 0.75 }),
      ]);

      for (let at = 3.5 * S; at <= 4.5 * S; at += S / 20) {
        expect(rectAt(keys, at, base, radius).width).toBeCloseTo(base.width * 0.7, 3);
      }
    });

    it("shrinks into the corner it is parked in", () => {
      // The bug this pins: it shrank about its own centre, so a bubble tucked
      // into a corner walked away from that corner as it got smaller — less in
      // the way and less tucked away at the same time.
      //
      // The near edges keep the margin they had; all the slack comes off the
      // far side.
      const { keys, base, radius } = cameraOf([region()], { cameraX: 0.87, cameraY: 0.77 });
      const held = rectAt(keys, 4 * S, base, radius);

      expect(held.x + held.width).toBeCloseTo(base.x + base.width, 3);
      expect(held.y + held.height).toBeCloseTo(base.y + base.height, 3);
    });

    it("shrinks into whichever corner that is", () => {
      const { keys, base, radius } = cameraOf([region()], { cameraX: 0.13, cameraY: 0.23 });
      const held = rectAt(keys, 4 * S, base, radius);

      expect(held.x).toBeCloseTo(base.x, 3);
      expect(held.y).toBeCloseTo(base.y, 3);
    });

    it("shrinks about the middle when there is no corner to go to", () => {
      // Nothing is near, so there is nothing to tuck into — and a bubble that
      // lurched sideways here would be moving for no reason a viewer could see.
      const { keys, base, radius } = cameraOf([region()], { cameraX: 0.5, cameraY: 0.5 });
      const held = rectAt(keys, 4 * S, base, radius);

      expect(held.x + held.width / 2).toBeCloseTo(base.x + base.width / 2, 3);
      expect(held.y + held.height / 2).toBeCloseTo(base.y + base.height / 2, 3);
    });

    it("keeps its corners in proportion as it shrinks", () => {
      // A bubble whose radius stayed put would change shape on the way in — at
      // this size the squircle is a rounded square, and a fixed radius on a
      // smaller box reads as a different object.
      const { keys, base, radius } = cameraOf([region()]);
      const held = rectAt(keys, 4 * S, base, radius);

      expect(held.radius).toBeCloseTo(radius * 0.7, 3);
    });

    it("takes its shadow with it", () => {
      const plan = buildRenderPlan(FRAME, { screen: SCREEN, camera: CAMERA }, withCamera(), null, [
        region(),
      ]);
      const shadow = plan.items.filter((item) => item.kind === "shadow").at(-1)!;
      if (shadow.kind !== "shadow") throw new Error("wrong item");

      const keys = shadow.motion ?? [];
      expect(keys.length).toBeGreaterThan(0);

      const rest = rectAt(keys, 0, shadow.rect, 0);
      const held = rectAt(keys, 4 * S, shadow.rect, 0);
      // Exactly in proportion, bleed and all. The room the blur falls off in is
      // scaled by the same factor as the picture, so the shadow stays as tight
      // to the bubble as it was rather than being left behind around it.
      expect(held.width).toBeCloseTo(rest.width * 0.7, 3);
    });

    it("leaves a camera that shares the frame alone", () => {
      // One of two cards cannot shrink without leaving a hole where it was.
      const { keys } = cameraOf([region()], { preset: "beside" });

      expect(keys).toHaveLength(0);
    });

    it("leaves the plan alone when it is switched off", () => {
      const { keys } = cameraOf([region()], { cameraShrinkOnZoom: false });

      expect(keys).toHaveLength(0);
    });
  });

  it("goes straight from one zoom to the next rather than through rest", () => {
    // The reason the moves had to come out of the slices. Two zooms back to
    // back used to pull all the way out at the boundary and push all the way
    // back in — twice the distance the eye actually had to travel, and a flinch
    // in the middle of what should read as one move.
    const { keys, base, radius } = motionOf([
      region({ id: "a", source: { start: 2 * S, end: 4 * S }, x: 0.25 }),
      region({ id: "b", source: { start: 4 * S, end: 6 * S }, x: 0.75 }),
    ]);

    // Sampled right through the join. The picture never comes back towards the
    // un-zoomed frame — it stays fully in and only travels sideways.
    for (let at = 3.5 * S; at <= 4.5 * S; at += S / 20) {
      expect(rectAt(keys, at, base, radius).width).toBeCloseTo(base.width * 2, 3);
    }

    // And it does travel: the two are aimed at opposite sides.
    expect(rectAt(keys, 3.5 * S, base, radius).x).not.toBeCloseTo(
      rectAt(keys, 4.5 * S, base, radius).x,
      0,
    );
  });

  it("comes back to rest between zooms that are far enough apart", () => {
    // The other half of the same rule. A gap with room for both moves is a gap:
    // the picture settles in the middle of it rather than sliding from one zoom
    // to the next across four seconds.
    const { keys, base, radius } = motionOf([
      region({ id: "a", source: { start: 2 * S, end: 3 * S }, x: 0.25 }),
      region({ id: "b", source: { start: 7 * S, end: 8 * S }, x: 0.75 }),
    ]);

    expect(rectAt(keys, 5 * S, base, radius).width).toBeCloseTo(base.width, 3);
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
      shapes: { arrow: { path: "cursor.png", hotspot: { x: 0, y: 0 } } },
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
    shapes: { arrow: { path: "cursor.png", hotspot: { x: 0, y: 0 } } },
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
          rotateX: 0,
          rotateY: 0,
          perspective: 0.5,
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

  const SPAN = 8 * S;
  const SPEED = 0.2;

  /** The shot, and the pointer drawn on it, for a pointer that does `samples`. */
  const shotFor = (samples: { at: number; x: number; y: number }[]) => {
    const plan = buildRenderPlan(
      FRAME,
      { screen: SCREEN, camera: null },
      settings(),
      {
        shapes: { arrow: { path: "cursor.png", hotspot: { x: 0, y: 0 } } },
        size: 0.035,
        hideAfter: null,
        samples,
      },
      [
        {
          ...DEFAULT_ZOOM,
          id: "z",
          source: { start: 0, end: SPAN },
          target: "cursor",
          level: 2,
          speed: SPEED,
        },
      ],
    );

    const picture = plan.items.find((item) => item.kind === "image" && item.source === "screen")!;
    const pointer = plan.items.find((item) => item.kind === "cursor")!;
    if (picture.kind !== "image" || pointer.kind !== "cursor") throw new Error("wrong items");

    return { keys: picture.motion ?? [], points: pointer.points };
  };

  /**
   * Only the keys with the shot fully pushed in.
   *
   * The transitions at either end move the rectangle by design — that is the
   * zoom — so every property below is about what the camera does once it has
   * arrived, with a beat of margin on each side.
   */
  const held = (keys: { at: number; x: number }[]) =>
    keys.filter((key) => key.at > (SPEED + 0.3) * S && key.at < SPAN - (SPEED + 0.3) * S);

  /** A pointer that holds `x` from `from` to `to`, sampled at 30 Hz. */
  const between = (from: number, to: number, at: (t: number) => number) =>
    Array.from({ length: Math.round(((to - from) * 30) / S) + 1 }, (_, step) => {
      const at_ = from + (step * S) / 30;
      return { at: Math.round(at_), x: at(at_), y: 0.5 };
    });

  it("holds still while the pointer moves inside the frame", () => {
    // The change everything else rests on. A camera that keeps its subject dead
    // centre is glued to it: the picture moves for every twitch of the hand and
    // the frame is never once allowed to rest. There has to be somewhere the
    // pointer can go without taking the picture with it.
    const keys = held(shotFor(between(0, SPAN, (t) => 0.5 + 0.03 * Math.sin((t / S) * 4))).keys);
    const xs = keys.map((key) => key.x);

    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1);
  });

  it("does not move before the pointer does", () => {
    // The failing of the filter this replaced: run forwards and then backwards
    // to cancel its own lag, it also cancelled causality, and the shot drifted
    // towards a flick the better part of a second before the hand made it.
    // Nothing on screen explains that movement, so it reads as float.
    const still = 4 * S;
    const keys = held(
      shotFor(
        between(0, SPAN, (t) => (t < still ? 0.3 : Math.min(0.8, 0.3 + (t - still) / (2 * S)))),
      ).keys,
    );

    const before = keys.filter((key) => key.at < still - 0.1 * S).map((key) => key.x);

    expect(Math.max(...before) - Math.min(...before)).toBeLessThan(1);
  });

  it("answers an ordinary move at a camera's speed, not a hand's", () => {
    // Unbounded, the shot chases the hand at whatever speed it managed and the
    // whole framing crosses in a few frames. That lurch is what makes a
    // followed zoom hard to watch even once the shake is gone. A deliberate
    // move across half the screen is well inside what a camera can do calmly.
    const keys = held(
      shotFor(
        between(0, SPAN, (t) => (t < 2 * S ? 0.3 : Math.min(0.7, 0.3 + ((t - 2 * S) / S) * 0.2))),
      ).keys,
    );
    const step = (keys[1]!.at - keys[0]!.at) / S;
    const speeds = keys.slice(1).map((key, index) => Math.abs(key.x - keys[index]!.x) / step);

    // No faster than the frame's shorter edge per second, which is a pan.
    expect(Math.max(...speeds)).toBeLessThan(Math.min(FRAME.width, FRAME.height));
  });

  it("never lets the pointer leave the shot, however fast the hand goes", () => {
    // The complaint this answers. A hand crossing the screen covers `level`
    // times as much picture as it does desk, so a camera held to a watchable
    // speed simply loses it: the pointer walks off the side and the shot is of
    // whatever it left behind. Between hurrying and pointing at nothing, the
    // camera hurries — there is no third answer, because a hand can move
    // faster than any pan anyone would want to watch.
    for (const hand of [
      // A flick: most of the screen inside a tenth of a second.
      (t: number) => (t < 2 * S ? 0.12 : Math.min(0.88, 0.12 + (t - 2 * S) / (0.1 * S))),
      // And back again, twice, which is where a camera that overshoots shows it.
      (t: number) => 0.5 + 0.42 * Math.sin(((t / S) * Math.PI) / 0.8),
    ]) {
      const { points } = shotFor(between(0, SPAN, hand));

      for (let at = 1.5 * S; at < SPAN - 1.5 * S; at += S / 30) {
        const point = cursorAt(points, Math.round(at));
        if (!point) continue;

        expect(Math.abs(point.x - FRAME.width / 2)).toBeLessThanOrEqual(FRAME.width / 2 + 1);
        expect(Math.abs(point.y - FRAME.height / 2)).toBeLessThanOrEqual(FRAME.height / 2 + 1);
      }
    }
  });

  it("catches up rather than giving up", () => {
    // A dead zone that never closed would be a camera that has stopped caring.
    // Asserted on the pointer as drawn, because that is the thing a viewer is
    // judging: it has to end up back near the middle of the frame.
    const { points } = shotFor(
      between(0, SPAN, (t) => (t < 2 * S ? 0.35 : Math.min(0.65, 0.35 + ((t - 2 * S) / S) * 0.15))),
    );
    const point = cursorAt(points, 7 * S)!;

    // Back inside the still area, which is the boundary the camera aims the
    // pointer at rather than the middle of the frame. It stops the instant the
    // pointer is inside rather than carrying on to centre it — that is what
    // makes the picture settle instead of hunting.
    expect(Math.abs(point.x - FRAME.width / 2)).toBeLessThan(FRAME.width / 2 / 3);
  });

  it("eases into the edge of the recording rather than stopping dead", () => {
    // The picture may not pull off the area it filled, and that limit used to
    // be applied to the finished rectangle — after the smoothing, so nothing
    // ever smoothed it. A shot travelling towards a corner arrived at full
    // speed and stopped in a single frame.
    //
    // Unhurried on purpose: this is about the follow easing into the wall, and
    // a hand quick enough to trip `KEEP_IN` is answered by the clamp instead,
    // which is allowed to arrive at the edge still moving. There is nowhere
    // else for it to go — the recording has run out.
    const keys = held(
      shotFor(between(0, SPAN, (t) => (t < S ? 0.5 : Math.max(0.02, 0.5 - ((t - S) / S) * 0.1))))
        .keys,
    );
    const speeds = keys.slice(1).map((key, index) => Math.abs(key.x - keys[index]!.x));
    const drops = speeds.slice(1).map((speed, index) => speeds[index]! - speed);

    // It has to have been moving, or there is nothing to decelerate.
    expect(Math.max(...speeds)).toBeGreaterThan(10);
    // And it has to shed that speed over many frames rather than one.
    expect(Math.max(...drops)).toBeLessThan(Math.max(...speeds) / 10);
  });
});

describe("hiding the pointer while typing", () => {
  const S = 1_000_000_000;
  const SHAPES = { arrow: { path: "cursor.png", hotspot: { x: 0.055, y: 0.055 } } };

  /** A pointer parked at the same spot from 0 to 10s, sampled as the capture would. */
  const PARKED = [
    { at: 0, x: 0.4, y: 0.4 },
    { at: 10 * S, x: 0.401, y: 0.401 },
  ];

  /** A pointer crossing the picture over the same ten seconds. */
  const CROSSING = Array.from({ length: 300 }, (_, step) => ({
    at: step * 33_000_000,
    x: 0.1 + step * 0.002,
    y: 0.4,
  }));

  const drawnAt = (
    samples: { at: number; x: number; y: number }[],
    keys: { start: number; end: number }[],
    at: number,
  ) => {
    const items = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings(),
      { shapes: SHAPES, size: 0.035, hideAfter: null, samples, keys },
    ).items.filter((item) => item.kind === "cursor");

    return items.some((item) => item.kind === "cursor" && cursorAt(item.points, at) !== null);
  };

  const TYPED = [{ start: 2 * S, end: 5 * S }];

  it("takes the pointer off the picture for the length of the typing", () => {
    expect(drawnAt(PARKED, TYPED, 1 * S)).toBe(true);
    expect(drawnAt(PARKED, TYPED, 3 * S)).toBe(false);
    expect(drawnAt(PARKED, TYPED, 8 * S)).toBe(true);
  });

  it("leaves it alone when the recording has no typing in it", () => {
    // Every recording made before the capture noted typing, which is not the
    // same as one where nobody typed — so an empty list may only ever mean
    // "draw the pointer".
    for (const at of [1 * S, 3 * S, 8 * S]) expect(drawnAt(PARKED, [], at)).toBe(true);
  });

  it("keeps a moving pointer on screen through it", () => {
    // Somebody typing with one hand and moving the mouse with the other. A
    // pointer that vanishes while it is travelling reads as a dropped frame,
    // and the one being moved is the one being used.
    expect(drawnAt(CROSSING, TYPED, 3 * S)).toBe(true);
  });

  it("writes its edges in without putting the points out of order", () => {
    // The markers are inserted mid-list, and `cursorAt` binary-searches what
    // comes out. One edge written behind the point before it reads as a pointer
    // that jumps back for a frame.
    const items = buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: SCREEN, camera: null },
      settings(),
      { shapes: SHAPES, size: 0.035, hideAfter: null, samples: CROSSING, keys: TYPED },
    ).items.filter((item) => item.kind === "cursor");

    for (const item of items) {
      if (item.kind !== "cursor") continue;
      const times = item.points.map((point) => point.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it("brings it back a moment after the last press, not on the instant", () => {
    // A pause between words is inside the span already; this is the end of the
    // sentence, where the pointer flashing back on reads as a flicker.
    expect(drawnAt(PARKED, TYPED, 5 * S + 200_000_000)).toBe(false);
    expect(drawnAt(PARKED, TYPED, 5 * S + 600_000_000)).toBe(true);
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
        shapes: { arrow: { path: "cursor.png", hotspot: { x: 0, y: 0 } } },
        size: 0.035,
        hideAfter: null,
        // The pointer sits in the far bottom-right, so which of the two the
        // shot is aiming at is never ambiguous.
        samples: [
          { at: 0, x: 0.9, y: 0.9 },
          { at: 12 * S, x: 0.9, y: 0.9 },
        ],
        typing,
      },
      [
        {
          // Spread first so a field added to a zoom later cannot break this fixture;
          // every value spelled out below still wins over the default.
          ...DEFAULT_ZOOM,
          id: "z",
          // Long enough for the shot to reach the far corner and settle. The
          // camera has a speed limit now, so "goes back to the pointer" is a
          // move across most of the picture rather than something that happens
          // between two samples.
          source: { start: 0, end: 12 * S },
          target,
          x: 0.5,
          y: 0.5,
          level: 2,
          speed: 0,
          rotateX: 0,
          rotateY: 0,
          perspective: 0.5,
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
    expect(shotAt("typing", FIELD, 10 * S).x).toBeCloseTo(shotAt("cursor", [], 10 * S).x, 0);
  });

  it("keeps following the pointer when the field is the whole window", () => {
    // An editor, a terminal, a note: the focused element is one text area
    // filling the window, and its middle is the middle of the frame wherever
    // the caret is. Aiming there parked the shot dead centre for as long as
    // somebody kept typing, and the pointer went wherever it liked without the
    // camera — which is the failure this was reported as.
    const page: Span[] = [{ at: 0, x: 0, y: 0, width: 1, height: 1 }];

    expect(shotAt("typing", page, 3 * S)).toEqual(shotAt("cursor", [], 3 * S));
  });

  it("still frames a field that only spans one direction", () => {
    // A search bar across the head of a window says nothing about where along
    // it to look and everything about how far down, so it is worth keeping.
    // Deliberately at the opposite end of the frame from the pointer, or the
    // two aims agree and the test cannot tell which one was used.
    const bar: Span[] = [{ at: 0, x: 0, y: 0.02, width: 1, height: 0.08 }];

    expect(shotAt("typing", bar, 3 * S).y).not.toBeCloseTo(shotAt("cursor", [], 3 * S).y, 0);
  });
});

describe("the camera's own zoom", () => {
  const tight = (cameraZoom: number, cameraShape: "circle" | "wide" = "circle") =>
    image(
      buildRenderPlan(
        LANDSCAPE,
        { screen: SCREEN, camera: CAMERA },
        settings({
          layout: {
            ...DEFAULT_SETTINGS.layout,
            cameraZoom,
            cameraShape,
            cameraWidth: DEFAULT_SETTINGS.layout.cameraHeight * shapeAspect(cameraShape, CAMERA),
          },
        }),
      ),
      "camera",
    )!.srcRect;

  it("shows all of the camera at 1×", () => {
    expect(tight(1)).toEqual(tight(1));
    // A bubble as wide as the camera crops nothing off it. Asserted loosely
    // because the width now arrives through a divide and a multiply rather than
    // as the source's own number.
    expect(tight(1, "wide")).toMatchObject({ x: expect.closeTo(0, 6), y: 0 });
    expect(tight(1, "wide").width).toBeCloseTo(CAMERA.width, 6);
    expect(tight(1, "wide").height).toBeCloseTo(CAMERA.height, 6);
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

  const cornersFor = (rotateX: number, rotateY: number, perspective = 0.5) => {
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
          rotateX,
          rotateY,
          perspective,
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

  it("converges harder at the near end of the perspective range", () => {
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

describe("captionAt", () => {
  /**
   * Deliberately identical to the fixture in
   * `crates/prequel-render/src/plan.rs`.
   *
   * This arithmetic exists on both sides — a plan cannot hold a rectangle per
   * output frame — so the numbers, not the code, are the contract between them.
   */
  const caption = (words: CaptionWord[] = []) =>
    ({
      kind: "caption",
      path: "captions/cue-3.png",
      bitmap: { width: 400, height: 100 },
      dstRect: { x: 100, y: 500, width: 800, height: 200 },
      span: { start: 1_000, end: 4_000 },
      words,
    }) satisfies Extract<PlanItem, { kind: "caption" }>;

  const spoken: CaptionWord[] = [
    { at: 1_000, end: 2_000, x: 0, y: 10, width: 100, height: 80, scale: 1 },
    // A gap from 2_000 to 3_000: silence between two words.
    { at: 3_000, end: 4_000, x: 200, y: 10, width: 100, height: 80, scale: 1 },
  ];

  it("draws the whole bitmap across its span when nothing is lit", () => {
    const draw = captionAt(caption(), 2_500)!;

    expect(draw.src).toEqual({ x: 0, y: 0, width: 400, height: 100 });
    expect(draw.dst).toEqual({ x: 100, y: 500, width: 800, height: 200 });
  });

  it("draws nothing outside its span", () => {
    expect(captionAt(caption(), 999)).toBeNull();
    // Half-open, so a cue ending where the next begins does not draw both.
    expect(captionAt(caption(), 4_000)).toBeNull();
    expect(captionAt(caption(spoken), 4_000)).toBeNull();
  });

  it("draws nothing between two words", () => {
    // Inside the span but in the silence. Holding the previous word lit through
    // the gap reads as the highlight lagging the voice.
    expect(captionAt(caption(spoken), 2_500)).toBeNull();
  });

  it("crops to the word being spoken", () => {
    const draw = captionAt(caption(spoken), 3_500)!;

    expect(draw.src).toEqual({ x: 200, y: 10, width: 100, height: 80 });
    // The bitmap is drawn at 2x here — 800 output pixels for 400 bitmap ones —
    // so every box inside it scales by the same two factors.
    expect(draw.dst).toEqual({ x: 500, y: 520, width: 200, height: 160 });
  });

  it("grows a popped word about its own centre", () => {
    const popped = spoken.map((word, index) => (index === 1 ? { ...word, scale: 1.5 } : word));

    const flat = captionAt(caption(spoken), 3_500)!;
    const grown = captionAt(caption(popped), 3_500)!;

    // The crop is untouched: a pop changes where the pixels land, never which
    // pixels are taken.
    expect(grown.src).toEqual(flat.src);

    const centre = (rect: { x: number; y: number; width: number; height: number }) => [
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    ];
    expect(centre(grown.dst)).toEqual(centre(flat.dst));
    expect(grown.dst.width).toBe(flat.dst.width * 1.5);
    expect(grown.dst.height).toBe(flat.dst.height * 1.5);
  });
});

describe("arriving from the slice before", () => {
  const BOTH = { screen: SCREEN, camera: CAMERA };
  const S = 1_000_000_000;
  const SPAN = { start: 10 * S, end: 20 * S };

  function planFor(preset: LayoutPreset, from: LayoutPreset | null) {
    return buildRenderPlan(
      LANDSCAPE,
      BOTH,
      settings({ layout: { ...DEFAULT_SETTINGS.layout, preset } }),
      null,
      [],
      from
        ? {
            from: settings({ layout: { ...DEFAULT_SETTINGS.layout, preset: from } }),
            source: SPAN,
          }
        : null,
    );
  }

  it("gives the camera a track that ends where it belongs", () => {
    const plan = planFor("beside", "over-full");
    const camera = image(plan, "camera")!;
    const keys = camera.motion!;

    // The move is only allowed to be a way of arriving. Ending anywhere but the
    // resting rectangle would leave the camera permanently offset, and every
    // frame after the transition would be wrong rather than just the opening
    // ones — which is the version of this bug nothing would catch.
    const last = keys[keys.length - 1]!;
    expect(last.x).toBeCloseTo(camera.dstRect.x, 6);
    expect(last.y).toBeCloseTo(camera.dstRect.y, 6);
    expect(last.width).toBeCloseTo(camera.dstRect.width, 6);
    expect(last.height).toBeCloseTo(camera.dstRect.height, 6);
  });

  it("starts the move at the moment the slice does", () => {
    const keys = image(planFor("beside", "over-full"), "camera")!.motion!;

    // Keyed in source time, the same clock the cursor track and the zooms use.
    // A track that opened at zero would have already finished before the slice
    // it belongs to started playing.
    expect(keys[0]!.at).toBe(SPAN.start);
    expect(keys[keys.length - 1]!.at).toBeLessThanOrEqual(SPAN.end);
  });

  it("never stretches the picture on the way", () => {
    const camera = image(planFor("beside", "over-full"), "camera")!;
    const wanted = camera.srcRect.width / camera.srcRect.height;

    // A plan item shows one crop, and a crop always has its destination's
    // aspect. Lerping the previous slice's actual box into this one would draw
    // that crop through a box of another shape — a face stretched widest at the
    // midpoint of every cut. `reshaped` is what stops it, and this is the
    // assertion that says so.
    for (const key of camera.motion!) {
      expect(key.width / key.height).toBeCloseTo(wanted, 6);
    }
  });

  it("grows a camera the arrangement before had no room for", () => {
    const keys = image(planFor("over-full", "screen-full"), "camera")!.motion!;

    // Out of nothing, because a plan item carries no opacity — a rectangle of
    // no size is the only entrance available, and it is a real one rather than
    // a fallback.
    expect(keys[0]!.width).toBe(0);
    expect(keys[0]!.height).toBe(0);
    expect(keys[keys.length - 1]!.width).toBeGreaterThan(0);
  });

  it("shrinks a camera this arrangement has no room for", () => {
    const plan = planFor("screen-full", "over-full");
    const camera = image(plan, "camera")!;
    const keys = camera.motion!;

    // The slice has no camera at all, so without this the bubble is simply gone
    // on the cut. It has to end at nothing as well as start somewhere: `rectAt`
    // holds the last key for the rest of the slice, so a track ending at any
    // size would leave a bubble parked on a composition that does not have one.
    expect(keys[0]!.width).toBeGreaterThan(0);
    expect(keys[keys.length - 1]!.width).toBe(0);
    expect(camera.dstRect.width).toBe(0);
  });

  it("takes the shadow with it, and lets it go", () => {
    const plan = planFor("screen-full", "over-full");
    const shadow = plan.items.find(
      (item): item is Extract<PlanItem, { kind: "shadow" }> =>
        item.kind === "shadow" && item.motion !== undefined,
    )!;
    const keys = shadow.motion!;

    // The shadow is grown around the picture, so a track that only shrank the
    // picture would leave a blur behind after the camera had gone — a soft grey
    // lozenge sitting on the frame for the rest of the clip.
    expect(keys[keys.length - 1]!.width).toBe(0);
    expect(keys[keys.length - 1]!.height).toBe(0);
  });

  it("says nothing when the arrangement leaves the camera where it was", () => {
    // `over-full` and `over-padded` both float the camera at the same fractions,
    // so nothing about it moves. A track of identical keys would be carried in
    // every plan and every export for no reason.
    expect(image(planFor("over-padded", "over-full"), "camera")!.motion).toBeUndefined();
  });

  it("does not move anything on the first slice", () => {
    // Nothing to arrive from. An export that assembled its own composition in
    // the first quarter-second would look like the render had not finished.
    expect(image(planFor("beside", null), "camera")!.motion).toBeUndefined();
  });

  it("leaves the screen alone", () => {
    // Only the camera moves. The screen's track is the zooms', derived from a
    // base rectangle that is fixed for the slice — sharing it needs the zoom
    // maths changed rather than added to, which is not what this does.
    expect(image(planFor("beside", "over-full"), "screen")!.motion).toBeUndefined();
  });

  it("cannot still be arriving when the clip ends", () => {
    const brief = buildRenderPlan(
      LANDSCAPE,
      BOTH,
      settings({ layout: { ...DEFAULT_SETTINGS.layout, preset: "beside" } }),
      null,
      [],
      {
        from: settings({ layout: { ...DEFAULT_SETTINGS.layout, preset: "over-full" } }),
        // A tenth of a second, well under the move's own length.
        source: { start: 0, end: S / 10 },
      },
    );

    const keys = image(brief, "camera")!.motion!;
    // Half the slice at most, the same cap a zoom's ease takes: a move still in
    // flight when the clip cuts never shows where it was going.
    expect(keys[keys.length - 1]!.at).toBeLessThanOrEqual(S / 20);
  });
});
