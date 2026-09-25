/**
 * That both shaders know about every look in the catalogue.
 *
 * The two are hand-kept mirrors — one in GLSL for the preview, one in MSL for
 * the export — and nothing compiles across the boundary. A look added to the
 * registry and to one shader draws in one place and not the other, which is the
 * worst shape this bug takes: the preview is right, the file is wrong, and the
 * only way anybody finds out is by exporting and looking.
 *
 * Reading the Metal by hand rather than through an import, because there is no
 * import to make. It is a `.metal` file `include_str!`-ed into a Rust crate; the
 * JavaScript build has no idea it exists, which is precisely the gap this
 * closes.
 *
 * What this cannot catch is a *stale* addon — the shipped `.node` containing an
 * older copy of the same file. `apps/desktop/package.json`'s `package` script
 * and `packages/recorder/turbo.json` are what stop that, and the note in
 * AGENTS.md is why.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FILTERS, type FilterId } from "../../../shared/filters";
import { FILTER_LOOKS, FILTER_SHADER_SOURCE } from "./filters";

const METAL = readFileSync(
  join(import.meta.dirname, "../../../../../../crates/prequel-render/src/filters.metal"),
  "utf8",
);

const ALL = Object.keys(FILTERS) as FilterId[];

/**
 * The shading function each look is drawn by, named the same on both sides.
 *
 * Written out rather than derived from the id: `lcd` is drawn by `panelled` and
 * `bloom` by `bloomed`, so there is no rule to derive, and a look added without
 * an entry here fails the totality check below rather than quietly skipping
 * every assertion that walks this map.
 */
const SHADER_FN: Record<FilterId, string> = {
  aberration: "aberration",
  grade: "graded",
  dither: "dithered",
  halftone: "halftoned",
  lcd: "panelled",
  fisheye: "bulged",
  crt: "tubed",
  vhs: "taped",
  film: "filmed",
  bloom: "bloomed",
  "window-light": "windowed",
  "lost-signal": "lost",
  // The four palettes are four looks drawn by one function, which differs only
  // by the span of the colour table it is handed. Named four times here rather
  // than special-cased: the checks below ask a question of every look, and a
  // look exempted from them is a look nothing asks about.
  pico8: "snapped",
  gameboy: "snapped",
  c64: "snapped",
  riso: "snapped",
  dream: "dreamt",
};

/** One function's source, from its signature to the closing brace in column 0. */
function body(source: string, signature: string): string | null {
  const at = source.indexOf(signature);
  if (at < 0) return null;
  const end = source.indexOf("\n}", at);
  return end < 0 ? null : source.slice(at, end);
}

describe("the two shaders", () => {
  it("numbers every look, once", () => {
    // `FILTER_LOOKS` is what the preview sends and `FilterKind::index` is what
    // the exporter sends. A look missing from here is one the preview cannot
    // ask for at all.
    expect(Object.keys(FILTER_LOOKS).sort()).toEqual([...ALL].sort());
    const numbers = Object.values(FILTER_LOOKS);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("gives every look an arm in the preview's switch", () => {
    const { fragment } = FILTER_SHADER_SOURCE();
    for (const id of ALL) {
      const look = FILTER_LOOKS[id];
      expect(fragment, `${id} (${look})`).toContain(`u_look == ${look}`);
    }
  });

  it("gives every look an arm in the exporter's switch", () => {
    // The half that was missing from the export for ten of the looks then in
    // the catalogue, and that no test noticed because the pixel tests compile
    // the crate from source while the app ships a binary built earlier.
    for (const id of ALL) {
      const look = FILTER_LOOKS[id];
      expect(METAL, `${id} (${look})`).toContain(`case ${look}:`);
    }
  });

  it("gives every look a swatch in the picker", () => {
    // Not a shader, but the same class of omission: a look in the catalogue
    // with no tile is a look nobody can choose, and it fails silently as an
    // empty square rather than as an error.
    const inspector = readFileSync(join(import.meta.dirname, "Inspector.tsx"), "utf8");
    for (const id of ALL) {
      const key = id.includes("-") ? `"${id}":` : `${id}:`;
      expect(inspector, id).toContain(key);
    }
  });

  it("flags exactly the looks whose shader reads the mip chain", () => {
    // The preview builds the chain only for looks with `blurs`, so a look whose
    // shader starts sampling a level and is not flagged silently loses its
    // softness — it falls back to the sharp top level, which reads as the
    // effect being weak rather than as a missing chain.
    //
    // Attributed per look rather than counted across the file: the fish eye
    // names a level three times, once per colour channel, and a count would
    // have to be kept in step with that by hand.
    const { fragment } = FILTER_SHADER_SOURCE();

    for (const [id, fn] of Object.entries(SHADER_FN) as [FilterId, string][]) {
      const glsl = body(fragment, `vec3 ${fn}(`) ?? body(fragment, `vec4 ${fn}(`);
      expect(glsl, `${fn} in the GLSL`).not.toBeNull();
      // Every other sample is pinned to `0.0` through `grab`; these name one.
      const levelled = /textureLod\(u_scene,[^;]*?,\s*[a-z_]\w*\s*\)/.test(glsl!);

      expect(levelled, `${id}: shader reads a level`).toBe(FILTERS[id].blurs);
    }
  });

  it("has the exporter read a level wherever the preview does", () => {
    // The same question of the other side. A look softened in one rasteriser
    // and not the other is the failure this whole pair of files is arranged to
    // prevent, and it would show only by exporting and comparing.
    const { fragment } = FILTER_SHADER_SOURCE();

    for (const [id, fn] of Object.entries(SHADER_FN) as [FilterId, string][]) {
      const glsl = body(fragment, `vec3 ${fn}(`) ?? body(fragment, `vec4 ${fn}(`);
      const msl = body(METAL, `static float3 ${fn}(`) ?? body(METAL, `static float4 ${fn}(`);
      expect(msl, `${fn} in the MSL`).not.toBeNull();

      const inGlsl = /textureLod\(u_scene,[^;]*?,\s*[a-z_]\w*\s*\)/.test(glsl!);
      const inMsl = /\.sample\(smp,[^;]*?level\([a-z_]\w*\)\)/.test(msl!);

      expect(inMsl, `${id}: exporter reads a level`).toBe(inGlsl);
    }
  });

  it("mirrors each shading function by name", () => {
    // Every function in one carries a "Mirrors X" note pointing at the other.
    // This checks the names actually exist on both sides rather than that the
    // comment is present — a renamed function with a stale note is the thing
    // that makes the convention untrustworthy.
    const { fragment } = FILTER_SHADER_SOURCE();
    const shared = [
      "centred",
      "spun",
      "luma",
      "hash21",
      "resolved",
      "wrap8",
      "bayer8",
      "PALETTE",
      "aberration",
      "graded",
      "blocked",
      "dithered",
      "snapped",
      "nearest",
      "halftoned",
      "panelled",
      "bulged",
      "tubed",
      "taped",
      "filmed",
      "bloomed",
      "windowed",
      "lost",
      "dreamt",
    ];
    for (const name of shared) {
      expect(fragment, `${name} in the GLSL`).toContain(name);
      expect(METAL, `${name} in the MSL`).toContain(name);
    }
  });
});
