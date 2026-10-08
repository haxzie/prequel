/**
 * The press animation.
 *
 * Two of these are the reason it exists at all. The dip has to be *sampled into
 * the track* — both rasterisers interpolate `scale` linearly between the two
 * points they land between, and the pointer is usually held still while it is
 * clicked, so without added samples the nearest real ones are seconds apart and
 * the whole animation is interpolated straight through. And it has to ride on
 * the `scale` the plan already carries, because that is the one number both
 * rasterisers already multiply the pointer's size by; a field of its own would
 * have to be honoured twice and could be honoured differently.
 */
import { describe, expect, it } from "vitest";

import { CLICK_EFFECTS } from "./click-effects";
import { buildRenderPlan, pressScale, rectAt } from "./layout";
import { DEFAULT_SETTINGS, DEFAULT_ZOOM, type ZoomSlice } from "./project";

const MS = 1_000_000;
const CLICK_NS = 180 * MS;

describe("pressScale", () => {
  it("is 1 with nothing to animate", () => {
    expect(pressScale(undefined, 0)).toBe(1);
    expect(pressScale([], 0)).toBe(1);
  });

  it("is 1 outside a press", () => {
    // Before it, and after it has finished. A pointer that stayed shrunk would
    // read as the size setting having changed rather than as a click.
    expect(pressScale([1000 * MS], 900 * MS)).toBe(1);
    expect(pressScale([1000 * MS], 1000 * MS + CLICK_NS + 1)).toBe(1);
  });

  it("dips and comes back", () => {
    const at = 1000 * MS;
    const middle = pressScale([at], at + CLICK_NS / 3);

    expect(middle).toBeLessThan(1);
    // Both ends sit at rest, so the dip cannot show up as a step.
    expect(pressScale([at], at)).toBeCloseTo(1, 5);
    expect(pressScale([at], at + CLICK_NS)).toBeCloseTo(1, 5);
  });

  it("comes back more slowly than it goes down", () => {
    // A press is a snap and a release. A symmetric dip reads as a wobble.
    const at = 0;
    const down = pressScale([at], CLICK_NS * 0.15);
    const up = pressScale([at], CLICK_NS * 0.85);

    // A sixth of the way in is already deeper than five sixths of the way out.
    expect(down).toBeLessThan(up);
  });

  it("never doubles up on a double-click", () => {
    // Two presses a few tens of milliseconds apart overlap. Multiplying their
    // dips would make the second visibly deeper than the first, which is the
    // opposite of what happened.
    const first = 0;
    const second = 60 * MS;
    const overlapped = pressScale([first, second], 60 * MS);
    const alone = pressScale([second], 60 * MS);

    expect(overlapped).toBeGreaterThanOrEqual(Math.min(alone, pressScale([first], 60 * MS)));
    // And never deeper than one press can go on its own.
    const deepest = Math.min(
      ...Array.from({ length: 64 }, (_, i) => pressScale([first], (CLICK_NS * i) / 63)),
    );
    expect(overlapped).toBeGreaterThanOrEqual(deepest);
  });
});

describe("a press in the plan", () => {
  /** A recording with one pointer sample at each end and a click in between. */
  function planWith(clicks: number[]) {
    const duration = 4_000 * MS;
    return buildRenderPlan(
      { width: 1920, height: 1080 },
      { screen: { width: 1920, height: 1080 }, camera: null },
      DEFAULT_SETTINGS,
      {
        // Held still, which is what actually happens while something is being
        // clicked — and is the case the animation has to survive.
        samples: [
          { at: 0, x: 0.5, y: 0.5 },
          { at: duration, x: 0.5, y: 0.5 },
        ],
        clicks,
        shapes: { arrow: { path: "cursor.png", hotspot: { x: 0, y: 0 } } },
        size: 0.035,
        hideAfter: null,
      },
      [],
      null,
    );
  }

  function cursorPoints(plan: ReturnType<typeof planWith>) {
    return plan.items.flatMap((item) => (item.kind === "cursor" ? item.points : []));
  }

  it("writes the dip into the track rather than leaving it to be interpolated", () => {
    // The failure this guards: with only the two real samples, four seconds
    // apart, every frame between them interpolates to a flat scale and the
    // press is never drawn at any size but its own.
    const still = cursorPoints(planWith([]));
    const clicked = cursorPoints(planWith([2_000 * MS]));

    expect(clicked.length).toBeGreaterThan(still.length);
    expect(Math.min(...clicked.map((point) => point.scale))).toBeLessThan(1);
    expect(Math.min(...still.map((point) => point.scale))).toBe(1);
  });

  it("leaves the pointer at rest either side of the press", () => {
    const points = cursorPoints(planWith([2_000 * MS]));
    const outside = points.filter(
      (point) => point.at < 2_000 * MS || point.at > 2_000 * MS + CLICK_NS,
    );

    expect(outside.every((point) => point.scale === 1)).toBe(true);
  });

  it("does not move the pointer to animate it", () => {
    // The dip is a size, not a position. A press that nudged the pointer would
    // point somewhere the click did not land.
    const points = cursorPoints(planWith([2_000 * MS]));
    const xs = new Set(points.map((point) => point.x.toFixed(6)));
    const ys = new Set(points.map((point) => point.y.toFixed(6)));

    expect(xs.size).toBe(1);
    expect(ys.size).toBe(1);
  });
});

describe("a click mark in the plan", () => {
  const frame = { width: 1920, height: 1080 };
  const sources = { screen: { width: 1920, height: 1080 }, camera: null };
  const marked = (effect: string) => ({
    ...DEFAULT_SETTINGS,
    layout: { ...DEFAULT_SETTINGS.layout, clickEffect: effect },
  });

  /** A recording with one press, and the pointer baked into its frames. */
  function planWith(effect: string, clicks: { at: number; x: number; y: number }[], zooms = []) {
    return buildRenderPlan(
      frame,
      sources,
      marked(effect),
      null,
      zooms,
      null,
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      clicks,
    );
  }

  function marks(plan: ReturnType<typeof planWith>) {
    return plan.items.filter((item) => item.kind === "click");
  }

  it("draws one mark per press, and none with the mark set to none", () => {
    const presses = [
      { at: 1_000 * MS, x: 0.5, y: 0.5 },
      { at: 1_040 * MS, x: 0.5, y: 0.5 },
    ];
    expect(marks(planWith("ripple", presses))).toHaveLength(2);
    expect(marks(planWith("none", presses))).toHaveLength(0);
    // A mark this build has never heard of draws as none, rather than failing
    // the plan.
    expect(marks(planWith("glitter", presses))).toHaveLength(0);
  });

  it("needs no pointer layer", () => {
    // The press is recorded whether or not the pointer was kept out of the
    // frames, and the mark goes on the picture. A recording with the pointer
    // baked in still gets one.
    const plan = planWith("ripple", [{ at: 1_000 * MS, x: 0.5, y: 0.5 }]);
    expect(plan.items.some((item) => item.kind === "cursor")).toBe(false);
    expect(marks(plan)).toHaveLength(1);
  });

  it("lasts the mark's own time and no longer", () => {
    const [mark] = marks(planWith("ripple", [{ at: 1_000 * MS, x: 0.5, y: 0.5 }]));
    expect(mark!.span.start).toBe(1_000 * MS);
    expect(mark!.span.end).toBe(1_000 * MS + CLICK_EFFECTS.ripple.duration);
    expect(mark!.keys[0]!.at).toBe(mark!.span.start);
    expect(mark!.keys[mark!.keys.length - 1]!.at).toBe(mark!.span.end);
  });

  it("sits where the press landed, in output pixels", () => {
    const [mark] = marks(planWith("ripple", [{ at: 1_000 * MS, x: 0.25, y: 0.75 }]));
    const screen = planWith("ripple", []).items.find((item) => item.kind === "image")!;
    const { dstRect } = screen;
    expect(mark!.keys[0]!.x).toBeCloseTo(dstRect.x + dstRect.width * 0.25, 3);
    expect(mark!.keys[0]!.y).toBeCloseTo(dstRect.y + dstRect.height * 0.75, 3);
    expect(mark!.keys[0]!.visible).toBe(true);
  });

  it("is drawn under the pointer", () => {
    // A ripple over the arrow reads as the arrow being behind glass.
    const plan = buildRenderPlan(
      frame,
      sources,
      marked("ripple"),
      {
        samples: [
          { at: 0, x: 0.5, y: 0.5 },
          { at: 4_000 * MS, x: 0.5, y: 0.5 },
        ],
        shapes: { arrow: { path: "cursor.png", hotspot: { x: 0, y: 0 } } },
        size: 0.035,
        hideAfter: null,
      },
      [],
      null,
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      [{ at: 1_000 * MS, x: 0.5, y: 0.5 }],
    );
    const kinds = plan.items.map((item) => item.kind);
    expect(kinds.indexOf("click")).toBeGreaterThan(-1);
    expect(kinds.indexOf("click")).toBeLessThan(kinds.indexOf("cursor"));
  });

  it("is marked invisible where the press fell outside the crop", () => {
    // Off the recorded area is off: a mark clamped to the edge would say the
    // click landed somewhere it did not.
    const [mark] = marks(planWith("ripple", [{ at: 1_000 * MS, x: 1.5, y: 0.5 }]));
    expect(mark!.keys.every((key) => !key.visible)).toBe(true);
  });

  it("rides the picture through a zoom", () => {
    // The mark is glued to what was clicked. A zoom that starts on the press
    // moves the picture under it, and the mark has to go with the button.
    const at = 1_000 * MS;
    const zoom = {
      ...DEFAULT_ZOOM,
      id: "z",
      source: { start: at, end: at + 2_000 * MS },
      target: "region",
      x: 0.5,
      y: 0.5,
      level: 2,
    } as ZoomSlice;
    const plan = buildRenderPlan(
      frame,
      sources,
      marked("ripple"),
      null,
      [zoom],
      null,
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      [{ at, x: 0.25, y: 0.25 }],
    );
    const [mark] = marks(plan);
    const screen = plan.items.find((item) => item.kind === "image")!;
    for (const key of mark!.keys) {
      const rect = rectAt(screen.motion ?? [], key.at, screen.dstRect, 0);
      // Where a quarter of the way across the picture is, *at this moment*.
      expect(key.x).toBeCloseTo(rect.x + rect.width * 0.25, 1);
      expect(key.y).toBeCloseTo(rect.y + rect.height * 0.25, 1);
    }
    // And there is a key wherever the picture's own motion has one inside the
    // span, so a straight line between the mark's two ends never cuts a curve.
    const inside = (screen.motion ?? []).filter(
      (key) => key.at > mark!.span.start && key.at < mark!.span.end,
    );
    for (const key of inside) {
      expect(
        mark!.keys.some((own) => own.at === key.at),
        `key at ${key.at}`,
      ).toBe(true);
    }
  });

  it("gives two presses two different seeds", () => {
    const [a, b] = marks(
      planWith("burst", [
        { at: 1_000 * MS, x: 0.5, y: 0.5 },
        { at: 1_037 * MS, x: 0.5, y: 0.5 },
      ]),
    );
    expect(a!.seed).not.toBe(b!.seed);
    expect(a!.seed).toBeGreaterThanOrEqual(0);
    expect(a!.seed).toBeLessThan(1);
  });
});
