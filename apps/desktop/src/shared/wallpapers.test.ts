import { describe, expect, it } from "vitest";

import {
  WALLPAPER_PALETTES,
  WALLPAPER_STYLES,
  wallpaperCatalogue,
  wallpaperFile,
  wallpaperPalette,
  wallpaperSvg,
  type WallpaperPalette,
} from "./wallpapers";

const LANDSCAPE = { width: 1920, height: 1080 };
const PORTRAIT = { width: 1080, height: 1920 };

function count(svg: string, needle: string): number {
  return svg.split(needle).length - 1;
}

/** Every colour the document actually names, lower-cased. */
function colours(svg: string): string[] {
  return [...svg.matchAll(/#[0-9a-f]{3,8}/gi)].map((match) => match[0].toLowerCase());
}

describe("the drawn backgrounds", () => {
  it("draws every style in every palette without falling over", () => {
    for (const style of WALLPAPER_STYLES) {
      for (const palette of WALLPAPER_PALETTES) {
        const svg = wallpaperSvg({ style: style.id, palette: palette.id }, LANDSCAPE);
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg.endsWith("</svg>")).toBe(true);
        // Something was actually drawn, rather than a surface and nothing on
        // it. Every style is paths, including the terrain — an empty `d` is
        // exactly the bare rectangle this is here to catch.
        expect(count(svg, "<path")).toBeGreaterThan(0);
        expect(svg).toContain('d="M');
      }
    }
  });

  it("is the size it was asked for", () => {
    const svg = wallpaperSvg(
      { style: "cutting-mat", palette: "olive" },
      { width: 3840, height: 2160 },
    );
    expect(svg).toContain('width="3840"');
    expect(svg).toContain('height="2160"');
    expect(svg).toContain('viewBox="0 0 3840 2160"');
  });

  it("draws the same thing twice", () => {
    // The file beside a recording is named after the recipe and the size, so a
    // second drawing of the same name has to be the same picture — the whole
    // skip-if-it-is-already-there in `main/wallpapers.ts` rests on this.
    const once = wallpaperSvg({ style: "cutting-mat", palette: "sand" }, LANDSCAPE);
    const twice = wallpaperSvg({ style: "cutting-mat", palette: "sand" }, LANDSCAPE);
    expect(once).toBe(twice);
  });

  it("uses only the palette's colours", () => {
    // What makes a palette served over HTTP mean anything. One hard-coded hex
    // in the drawing is a colour the API cannot change, and it would show up
    // as the one line that stays grey when everything else goes green.
    for (const style of WALLPAPER_STYLES) {
      const palette = wallpaperPalette("rose");
      const svg = wallpaperSvg({ style: style.id, palette: "rose" }, LANDSCAPE);
      const allowed = new Set(
        [palette.surface, palette.line, palette.rule, palette.ink, palette.accent].map((colour) =>
          colour.toLowerCase(),
        ),
      );

      for (const colour of colours(svg)) expect(allowed).toContain(colour);
    }
  });

  it("turns rather than stretches when the frame does", () => {
    // The reason these are drawn at all. Both frames have the same shorter
    // edge, so both hold the same mat — one on its side. A grid worked out
    // from the width instead of the shorter edge passes nothing here.
    const landscape = wallpaperSvg({ style: "cutting-mat", palette: "olive" }, LANDSCAPE);
    const portrait = wallpaperSvg({ style: "cutting-mat", palette: "olive" }, PORTRAIT);

    expect(count(portrait, "<text")).toBe(count(landscape, "<text"));
  });

  it("falls back rather than drawing nothing", () => {
    // A project written by a build with styles this one does not have still
    // opens, and a palette the API has since removed still draws.
    const svg = wallpaperSvg({ style: "no-such-style", palette: "no-such-palette" }, LANDSCAPE);
    expect(svg).toContain(WALLPAPER_PALETTES[0]!.surface);
    expect(count(svg, "<path")).toBeGreaterThan(0);
  });

  it("resolves a palette the catalogue carries and this build does not", () => {
    const invented: WallpaperPalette = {
      id: "invented",
      label: "Invented",
      surface: "#010203",
      line: "#040506",
      rule: "#070809",
      ink: "#0a0b0c",
      accent: "#0d0e0f",
    };
    const catalogue = { ...wallpaperCatalogue(), palettes: [invented] };

    const svg = wallpaperSvg({ style: "graph", palette: "invented" }, LANDSCAPE, catalogue);
    expect(svg).toContain("#010203");
  });

  it("traces the same landscape at every size", () => {
    // The sample grid and the field are deliberately independent: the grid
    // decides how smooth a contour is, the field decides how big the hills
    // are. Tie them together and a swatch stops being a miniature of the
    // frame — which is the one thing the picker promises.
    const tile = wallpaperSvg({ style: "terrain", palette: "olive" }, { width: 320, height: 200 });
    const frame = wallpaperSvg({ style: "terrain", palette: "olive" }, LANDSCAPE);

    // The first contour of a 320-wide tile and of a 1920-wide frame start in
    // the same place on the landscape, to within a sample.
    const first = (svg: string, scale: number): { x: number; y: number } => {
      const match = /d="M([\d.]+) ([\d.]+)/.exec(svg);
      return { x: Number(match?.[1]) / scale, y: Number(match?.[2]) / scale };
    };

    const tile0 = first(tile, 200);
    const frame0 = first(frame, 1080);

    expect(Math.abs(tile0.x - frame0.x)).toBeLessThan(0.05);
    expect(Math.abs(tile0.y - frame0.y)).toBeLessThan(0.05);
  });

  it("names a different file for every size, palette and catalogue version", () => {
    const spec = { style: "cutting-mat", palette: "olive" };
    const names = new Set([
      wallpaperFile(spec, LANDSCAPE, 1),
      wallpaperFile(spec, PORTRAIT, 1),
      wallpaperFile(spec, LANDSCAPE, 2),
      wallpaperFile({ ...spec, palette: "sand" }, LANDSCAPE, 1),
    ]);

    expect(names.size).toBe(4);
  });

  it("names a file main will accept", () => {
    // Kept in step with `DRAWN` in `main/wallpapers.ts` by hand: main refuses
    // anything else, and the failure is a background that never appears.
    const drawn = /^pattern-[a-z0-9-]+-v\d+-\d+x\d+\.png$/;

    for (const style of WALLPAPER_STYLES) {
      for (const palette of WALLPAPER_PALETTES) {
        expect(wallpaperFile({ style: style.id, palette: palette.id }, LANDSCAPE, 1)).toMatch(
          drawn,
        );
      }
    }
  });
});
