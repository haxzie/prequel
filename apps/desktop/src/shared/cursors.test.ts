/**
 * That every pointer the editor offers has artwork behind it.
 *
 * The failure this catches is quiet and total: `cursorLayer` copies
 * `CURSOR_FILES` into a recording on open and gives up on the first one it
 * cannot find, so a style naming a missing PNG is not a style that draws wrong
 * — it is a recording that opens with no pointer at all, which reads as a take
 * captured with the cursor hidden.
 *
 * The same guard `backgrounds.test.ts` keeps over the shipped wallpapers, and
 * for the same reason: the list and the folder are edited separately.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CURSOR_FILES,
  CURSOR_STYLES,
  cursorArrivesWith,
  cursorImages,
  cursorStyle,
  cursorSwatch,
} from "./contract";
import { CLICK_EFFECTS } from "./click-effects";
import { buildRenderPlan } from "./layout";
import { CLICK_SOUNDS, DEFAULT_LAYOUT, DEFAULT_SETTINGS } from "./project";

const RESOURCES = fileURLToPath(new URL("../../resources", import.meta.url));

describe("the pointers", () => {
  it("ships a file for every image any style asks for", () => {
    const missing = CURSOR_FILES.filter((file) => !existsSync(join(RESOURCES, file)));
    expect(missing).toEqual([]);
  });

  it("gives every style an arrow, which is what a missing kind falls back to", () => {
    // `cursorImages` draws the arrow for any kind a style does not ship, so a
    // style without one has nothing to draw for a pointer over a link.
    for (const style of CURSOR_STYLES) {
      expect(cursorImages(style.id).shapes.arrow).toBeDefined();
    }
  });

  it("keeps every hotspot inside its own picture", () => {
    // A hotspot outside the artwork puts the pointer's acting point somewhere
    // the drawing is not, which reads as the cursor lagging its own clicks.
    for (const style of CURSOR_STYLES) {
      for (const shape of Object.values(style.shapes)) {
        expect(shape.hotspot.x).toBeGreaterThanOrEqual(0);
        expect(shape.hotspot.x).toBeLessThanOrEqual(1);
        expect(shape.hotspot.y).toBeGreaterThanOrEqual(0);
        expect(shape.hotspot.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it("has no two styles sharing an id", () => {
    // `cursorStyle` finds by id and answers with the first match, so a repeat
    // would be a style nobody can select — the picker would show two cells and
    // light the same one.
    const ids = CURSOR_STYLES.map((style) => style.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to the default for an id it does not know", () => {
    expect(cursorStyle("not-a-style").id).toBe(CURSOR_STYLES[0].id);
  });

  it("gives the picker a tile for every style", () => {
    // `cursorSwatch` answers with the pointer itself where a style ships no
    // tile of its own, so the only way this is empty is a `swatch` naming a
    // file that is not there — a tile that 404s in the panel.
    const missing = CURSOR_STYLES.map((style) => cursorSwatch(style.id)).filter(
      (file) => !existsSync(join(RESOURCES, file)),
    );
    expect(missing).toEqual([]);
  });

  it("draws a reaching pointer long enough to leave the frame", () => {
    // The one thing that makes the stick a style rather than a picture: the
    // handle has to run off the edge from the furthest corner, at any Size and
    // in either orientation. Shorter and its end is in the picture, which is a
    // baton rather than a pointer.
    //
    // Against the plan rather than against `reachingSize`, which is not
    // exported: this is the number both rasterisers are handed.
    const reaching = CURSOR_STYLES.filter((style) => "reach" in style);
    expect(reaching.length).toBeGreaterThan(0);

    for (const style of reaching) {
      for (const frame of [
        { width: 1920, height: 1080 },
        { width: 1080, height: 1920 },
        { width: 1440, height: 1440 },
      ]) {
        for (const size of [0.005, DEFAULT_LAYOUT.cursorSize, 0.08]) {
          const plan = buildRenderPlan(
            frame,
            { screen: { width: 1920, height: 1080 }, camera: null },
            {
              ...DEFAULT_SETTINGS,
              layout: { ...DEFAULT_SETTINGS.layout, cursorStyle: style.id, cursorSize: size },
            },
            {
              ...cursorImages(style.id),
              samples: [{ at: 0, x: 0.5, y: 0.5 }],
              size,
              hideAfter: null,
            },
          );

          const pointer = plan.items.find((item) => item.kind === "cursor");
          expect(pointer?.kind).toBe("cursor");
          // The artwork's rod runs more than the sprite's own side, and the
          // furthest a line at the pointer's lean travels inside a frame
          // before leaving it is twice the shorter edge — a tall frame, the
          // pointer in the top corner, the rod leaving by the side rather than
          // the bottom. A sprite at least that big clears it from anywhere.
          const shorter = Math.min(frame.width, frame.height);
          expect(pointer && "size" in pointer ? pointer.size : 0).toBeGreaterThanOrEqual(
            2 * shorter,
          );
        }
      }
    }
  });

  it("never leans a reaching pointer", () => {
    // The lean turns the sprite about its hotspot. On an arrow that nudges the
    // tail; on a stick it swings two frames of handle across the picture, and
    // the handle is drawn at the one angle the artwork was leaned onto.
    for (const style of CURSOR_STYLES.filter((entry) => "reach" in entry)) {
      const plan = buildRenderPlan(
        { width: 1920, height: 1080 },
        { screen: { width: 1920, height: 1080 }, camera: null },
        {
          ...DEFAULT_SETTINGS,
          layout: { ...DEFAULT_SETTINGS.layout, cursorStyle: style.id, cursorTilt: 1 },
        },
        {
          ...cursorImages(style.id),
          // Flung across the frame, which is what earns the full lean.
          samples: [
            { at: 0, x: 0.1, y: 0.5 },
            { at: 100 * 1_000_000, x: 0.9, y: 0.5 },
          ],
          size: DEFAULT_LAYOUT.cursorSize,
          hideAfter: null,
        },
      );

      const points = plan.items.flatMap((item) => (item.kind === "cursor" ? item.points : []));
      expect(points.length).toBeGreaterThan(0);
      // A leaned point carries the four corners the lean turned; an upright one
      // carries none, which is what both rasterisers read as "use the box".
      expect(points.every((point) => point.quad === undefined)).toBe(true);
    }
  });

  it("taps on a press, less deeply the further the pointer reaches", () => {
    // The dip is a scale about the hotspot, so it moves every part of the
    // sprite by that share of its distance from the tip. A stick dipped as far
    // as an arrow is a handle sliding a third of a frame along itself, which is
    // a telescope rather than a tap — so it dips, and dips less.
    const at = 400 * 1_000_000;
    const deepest = (styleId: string) => {
      const plan = buildRenderPlan(
        { width: 1920, height: 1080 },
        { screen: { width: 1920, height: 1080 }, camera: null },
        {
          ...DEFAULT_SETTINGS,
          layout: { ...DEFAULT_SETTINGS.layout, cursorStyle: styleId },
        },
        {
          ...cursorImages(styleId),
          // Held still through the press, which is what a hand actually does
          // while it clicks — the dip is written into the track as its own
          // points rather than borrowed from a sample that is not there.
          samples: [
            { at: 0, x: 0.5, y: 0.5 },
            { at: at * 2, x: 0.5, y: 0.5 },
          ],
          clicks: [at],
          size: DEFAULT_LAYOUT.cursorSize,
          hideAfter: null,
        },
      );

      const points = plan.items.flatMap((item) => (item.kind === "cursor" ? item.points : []));
      return Math.min(...points.map((point) => point.scale));
    };

    const stick = deepest("stick");
    const arrow = deepest(CURSOR_STYLES[0].id);

    expect(arrow).toBeLessThan(1);
    expect(stick).toBeLessThan(1);
    expect(stick).toBeGreaterThan(arrow);
  });

  it("names a mark and a sound that exist, for a style that arrives with them", () => {
    // The one thing a typo here costs: `CURSOR_STYLES` holds ids rather than
    // the catalogues, so a misspelt one is not a build error — it is a pointer
    // that arrives with no mark and the click sound switched to something the
    // panel cannot show, and nothing says so.
    for (const style of CURSOR_STYLES) {
      const arrives = cursorArrivesWith(style.id);
      if (!arrives) continue;
      expect(Object.keys(CLICK_EFFECTS), `${style.id}'s mark`).toContain(arrives.mark);
      expect(
        CLICK_SOUNDS.map((sound) => sound.id),
        `${style.id}'s sound`,
      ).toContain(arrives.sound);
    }
  });

  it("sizes a reaching pointer from the Size it was drawn for", () => {
    // `reachingSize` repeats `DEFAULT_LAYOUT.cursorSize` rather than importing
    // it, because `project.ts` imports `layout.ts` and the value coming back
    // would be a cycle. This is the pin on that copy: drift and the stick
    // jumps a size the moment the default moves.
    expect(DEFAULT_LAYOUT.cursorSize).toBe(0.035);
  });
});
