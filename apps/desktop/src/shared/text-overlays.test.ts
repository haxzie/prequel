/**
 * Texts in the plan.
 *
 * The invariants the preview and the export both lean on: a text is placed
 * once, inside the frame, drawn over the pictures and under the captions, and
 * `overlayAt` reads a key list the same way `overlay_at` does on the other
 * side — the fixture here is deliberately the one in `plan.rs`.
 */
import { describe, expect, it } from "vitest";

import {
  buildRenderPlan,
  overlayAt,
  textBlockRect,
  withWholeTimes,
  type OverlayKey,
  type PlanItem,
  type RenderedCue,
  type RenderedText,
  type Size,
} from "./layout.js";
import { DEFAULT_SETTINGS, type TextSlice, type TextTrack } from "./project.js";
import { textFromTemplate, textTemplate } from "./text-templates.js";

const S = 1_000_000_000;
const FRAME: Size = { width: 1920, height: 1080 };
const SCREEN: Size = { width: 2560, height: 1440 };

/** A two-field text, over a 4 s stretch. */
const text = (over: Partial<TextSlice> = {}): TextSlice => ({
  ...textFromTemplate(textTemplate("title-subtitle"), "text-1", { start: 2 * S, end: 6 * S }),
  ...over,
});

/** What the rasteriser hands back: one block unit per field. */
const rendered = (fields = 2): RenderedText => ({
  fields: Array.from({ length: fields }, (_, index) => ({
    path: `texts/field-${index}.png`,
    bitmap: { width: 800, height: 120 },
    extent: { width: 800, height: 120 },
    units: [
      {
        cell: { x: 0, y: 0, width: 800, height: 120 },
        place: { x: 0, y: 0, width: 800, height: 120 },
      },
    ],
    fontSize: 80,
    drawnFrame: FRAME,
    drawnSize: index === 0 ? 0.09 : 0.04,
  })),
});

const plan = (tracks: TextTrack[], drawn: Map<string, RenderedText>, cues?: RenderedCue[]) =>
  buildRenderPlan(
    FRAME,
    { screen: SCREEN, camera: null },
    { ...DEFAULT_SETTINGS, watermark: { ...DEFAULT_SETTINGS.watermark, watermark: "mark.png" } },
    undefined,
    undefined,
    undefined,
    cues,
    tracks,
    drawn,
  ).items;

const overlays = (items: PlanItem[]) =>
  items.filter((item): item is Extract<PlanItem, { kind: "overlay" }> => item.kind === "overlay");

describe("texts in the plan", () => {
  it("draws nothing for a text that has not been rasterised yet", () => {
    const items = plan([{ id: "t", slices: [text()] }], new Map());
    expect(overlays(items)).toHaveLength(0);
  });

  it("emits one overlay per unit, over the watermark and under the captions", () => {
    const cue: RenderedCue = {
      at: S,
      end: 3 * S,
      layers: [{ path: "captions/c.png", words: [] }],
      bitmap: { width: 400, height: 100 },
      size: { width: 0.2, height: 0.1 },
      drawnSize: DEFAULT_SETTINGS.captions.captionSize,
    };
    const items = plan([{ id: "t", slices: [text()] }], new Map([["text-1", rendered()]]), [cue]);
    const kinds = items.map((item) => item.kind);

    expect(overlays(items)).toHaveLength(2);
    expect(kinds.indexOf("overlay")).toBeGreaterThan(kinds.indexOf("watermark"));
    expect(kinds.lastIndexOf("overlay")).toBeLessThan(kinds.indexOf("caption"));
  });

  it("keeps every key inside the frame once the block is at rest", () => {
    // Pushed to the very corner: the block is held inside rather than let off.
    const items = overlays(
      plan([{ id: "t", slices: [text({ x: 1, y: 1 })] }], new Map([["text-1", rendered()]])),
    );
    for (const item of withWholeTimes(items)) {
      for (const key of item.keys) {
        expect(Number.isInteger(key.at)).toBe(true);
        expect(key.width).toBeGreaterThan(0);
        expect(key.height).toBeGreaterThan(0);
        if (key.opacity === 1) {
          expect(key.x).toBeGreaterThanOrEqual(0);
          expect(key.y).toBeGreaterThanOrEqual(0);
          expect(key.x + key.width).toBeLessThanOrEqual(FRAME.width + 1e-6);
          expect(key.y + key.height).toBeLessThanOrEqual(FRAME.height + 1e-6);
        }
      }
    }
  });

  it("scales a bitmap drawn for one size to stand in for another", () => {
    const drawn = new Map([["text-1", rendered()]]);
    const before = overlays(plan([{ id: "t", slices: [text()] }], drawn))[0]!;

    const bigger = text();
    bigger.fields[0]!.style.size *= 2;
    const after = overlays(plan([{ id: "t", slices: [bigger] }], drawn))[0]!;

    const held = (item: typeof before) => item.keys.find((key) => key.opacity === 1)!;
    expect(held(after).width).toBeCloseTo(held(before).width * 2);
  });

  it("draws a higher row over a lower one", () => {
    const lower = text({ id: "low" });
    const upper = text({ id: "up" });
    const drawn = new Map([
      ["low", rendered(1)],
      ["up", rendered(1)],
    ]);
    const items = overlays(
      plan(
        [
          { id: "a", slices: [lower] },
          { id: "b", slices: [upper] },
        ],
        drawn,
      ),
    );
    expect(items.map((item) => item.path)).toEqual(["texts/field-0.png", "texts/field-0.png"]);
    expect(items[1]!.keys[0]!.y).toBe(items[0]!.keys[0]!.y);
  });
});

describe("textBlockRect", () => {
  it("is the box every unit rests in", () => {
    const drawn = new Map([["text-1", rendered()]]);
    const slice = text();
    const block = textBlockRect(FRAME, slice, drawn)!;
    const items = overlays(plan([{ id: "t", slices: [slice] }], drawn));

    for (const item of items) {
      const held = item.keys.find((key) => key.opacity === 1)!;
      expect(held.x).toBeGreaterThanOrEqual(block.x - 1e-6);
      expect(held.y).toBeGreaterThanOrEqual(block.y - 1e-6);
      expect(held.x + held.width).toBeLessThanOrEqual(block.x + block.width + 1e-6);
      expect(held.y + held.height).toBeLessThanOrEqual(block.y + block.height + 1e-6);
    }
    // Centred where the text says.
    expect(block.x + block.width / 2).toBeCloseTo(FRAME.width / 2);
    expect(block.y + block.height / 2).toBeCloseTo(FRAME.height / 2);
  });

  it("is null before anything has been drawn", () => {
    expect(textBlockRect(FRAME, text(), new Map())).toBeNull();
  });
});

describe("overlayAt", () => {
  /** The same keys `overlay_at` is tested against in `plan.rs`. */
  const key = (at: number, y: number, opacity: number, blur: number): OverlayKey => ({
    at,
    x: 100,
    y,
    width: 200,
    height: 50,
    opacity,
    blur,
  });
  const keys = [
    key(1_000, 130, 0, 12),
    key(2_000, 100, 1, 0),
    key(4_000, 100, 1, 0),
    key(5_000, 100, 0, 0),
  ];

  const item = (span = { start: 500, end: 6_000 }): Extract<PlanItem, { kind: "overlay" }> => ({
    kind: "overlay",
    path: "texts/x.png",
    bitmap: { width: 400, height: 100 },
    src: { x: 0, y: 0, width: 200, height: 50 },
    span,
    keys,
  });

  it("is absent outside the span and held flat outside the keys", () => {
    expect(overlayAt(item(), 499)).toBeNull();
    expect(overlayAt(item(), 6_000)).toBeNull();

    expect(overlayAt(item(), 500)).toEqual({
      dst: { x: 100, y: 130, width: 200, height: 50 },
      opacity: 0,
      blur: 12,
    });
    expect(overlayAt(item(), 5_999)).toEqual({
      dst: { x: 100, y: 100, width: 200, height: 50 },
      opacity: 0,
      blur: 0,
    });
  });

  it("lerps between its keys", () => {
    const draw = overlayAt(item({ start: 0, end: 10_000 }), 1_500)!;
    expect(draw.dst.y).toBeCloseTo(115);
    expect(draw.opacity).toBeCloseTo(0.5);
    expect(draw.blur).toBeCloseTo(6);

    expect(overlayAt(item({ start: 0, end: 10_000 }), 3_000)).toMatchObject({ opacity: 1 });
  });

  it("steps over two keys on one nanosecond", () => {
    const doubled = {
      ...item({ start: 0, end: 10_000 }),
      keys: [keys[0]!, { ...keys[1]!, at: 4_000, opacity: 0 }, keys[2]!, keys[3]!],
    };
    const draw = overlayAt(doubled, 4_000)!;
    expect(Number.isFinite(draw.opacity)).toBe(true);
    expect(draw.opacity).toBe(1);
  });
});
