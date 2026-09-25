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
    // The half that was missing from the export for ten of the eleven looks,
    // and that no test noticed because the pixel tests compile the crate from
    // source while the app ships a binary built earlier.
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

  it("flags exactly the looks that read the mip chain", () => {
    // The preview builds the chain only for looks with `blurs`, so a look whose
    // shader starts sampling a level and is not flagged silently loses its
    // softness — it falls back to the sharp top level, which looks like the
    // effect being weak rather than like a missing chain.
    //
    // Counted off the source rather than listed, so adding one to a shader and
    // not to the catalogue fails here. Every other sample is pinned to `0.0`
    // through `grab`; these are the ones that name a level.
    const { fragment } = FILTER_SHADER_SOURCE();
    const levelled = [...fragment.matchAll(/textureLod\(u_scene,[^;]*?,\s*([a-z_][\w]*)\s*\)/g)];
    const flagged = ALL.filter((id) => FILTERS[id].blurs);

    expect(levelled.length, "shader calls naming a level").toBe(flagged.length);
    expect(flagged.sort()).toEqual(["bloom", "fisheye"]);

    // The exporter names a level in the same two places, and pins everything
    // else to the top. Counted, not listed, for the reason above.
    const msl = [...METAL.matchAll(/\.sample\(smp,[^;]*?level\(([a-z_][\w]*)\)\)/g)];
    expect(msl.length, "exporter calls naming a level").toBe(flagged.length);
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
      "aberration",
      "graded",
      "pixelated",
      "halftoned",
      "panelled",
      "bulged",
      "tubed",
      "taped",
      "filmed",
      "bloomed",
      "windowed",
    ];
    for (const name of shared) {
      expect(fragment, `${name} in the GLSL`).toContain(name);
      expect(METAL, `${name} in the MSL`).toContain(name);
    }
  });
});
