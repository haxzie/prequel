/**
 * What a shader compiler would tell you, if one were reachable from here.
 *
 * The GLSL in `webgl.ts` is compiled at runtime by the renderer's GPU driver.
 * Nothing in the build sees it: a mistake there passes typecheck, passes every
 * other test, packages, signs, notarises and installs — and then draws an
 * entirely blank preview, because `compile` logs the failure once and the
 * compositor has nothing to draw with. This is the cheapest approximation of
 * that missing compiler: the class of mistake that is invisible everywhere
 * else and obvious once named.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FILTER_SHADER_SOURCE } from "./filters";
import { SHADER_SOURCE } from "./webgl";

/**
 * Words GLSL ES 3.00 keeps for itself, from §3.6 of the specification.
 *
 * None of them does anything today; all of them are a compile error used as an
 * identifier. Several read as perfectly ordinary variable names — `cast`,
 * `filter`, `input`, `output`, `this`, `resource` — which is exactly why they
 * are worth a test rather than care.
 */
const RESERVED = [
  "active",
  "asm",
  "cast",
  "class",
  "common",
  "enum",
  "extern",
  "external",
  "filter",
  "fixed",
  "fvec2",
  "fvec3",
  "fvec4",
  "goto",
  "half",
  "hvec2",
  "hvec3",
  "hvec4",
  "inline",
  "input",
  "interface",
  "long",
  "namespace",
  "noinline",
  "output",
  "partition",
  "public",
  "resource",
  "short",
  "sizeof",
  "static",
  "superp",
  "template",
  "this",
  "typedef",
  "union",
  "unsigned",
  "using",
];

/** The source with its comments taken out — prose may say "this" freely. */
const code = (source: string) =>
  source.replaceAll(/\/\*[\s\S]*?\*\//g, " ").replaceAll(/\/\/[^\n]*/g, " ");

/**
 * Both pairs, because both are compiled by the same driver and neither is seen
 * by the build. The filter pair is the newer and the likelier of the two to
 * break this way: it grows an arm per look, and a look is written in one sitting
 * and looked at on one machine.
 */
const PAIRS = [
  ["the item shader", SHADER_SOURCE()],
  ["the filter shader", FILTER_SHADER_SOURCE()],
] as const;

describe.each(PAIRS)("%s", (_name, pair) => {
  const sources = Object.entries(pair);

  for (const [stage, source] of sources) {
    it(`declares no reserved word in the ${stage} stage`, () => {
      const found = RESERVED.filter((word) => new RegExp(`\\b${word}\\b`).test(code(source)));

      expect(found).toEqual([]);
    });

    it(`writes every number in the ${stage} stage as a float`, () => {
      // The other silent one. GLSL ES has no implicit int-to-float, so an
      // interpolated constant that lands as `3` rather than `3.0` fails to
      // compile wherever it meets a float — and a constant is exactly the sort
      // of thing that gets interpolated from TypeScript, where 3 and 3.0 are
      // the same number.
      // A whole number meeting a name across an operator. The lookbehind is
      // what keeps `1.0 - x` out of it: without it the `0` after the point
      // reads as a whole number all on its own.
      const mixed = code(source).match(/(?<![\w.])\d+\s*[*/+-]\s*[a-z_]\w*/gi) ?? [];

      expect(mixed).toEqual([]);
    });
  }

  it("has both stages", () => {
    expect(sources.map(([stage]) => stage)).toEqual(["vertex", "fragment"]);
  });
});

/**
 * The outline's arithmetic, on both sides.
 *
 * The camera shape that follows somebody is the one shape a rasteriser *derives*
 * rather than being handed: the plan carries circles and each side unions them.
 * Two slightly different unions is a preview and an export whose outlines differ
 * where a hand meets a shoulder — visible only by exporting and comparing, and
 * only on the take that has the hand in it.
 *
 * Read from disk rather than imported, for the reason `filters.test.ts` does it:
 * the MSL is a `.metal` file `include_str!`-ed into a Rust crate, and there is no
 * import to make.
 */
const METAL = readFileSync(
  join(import.meta.dirname, "../../../../../../crates/prequel-render/src/shaders.metal"),
  "utf8",
);

/** A function's body, from its signature to the closing brace of its block. */
function body(source: string, signature: string): string | null {
  const at = source.indexOf(signature);
  if (at < 0) return null;
  const end = source.indexOf("\n}", at);
  return end < 0 ? null : source.slice(at, end);
}

/**
 * The statements, with everything that is only spelling taken out.
 *
 * Comments, whitespace, the two languages' names for the same types and the two
 * spellings of the same identifier. What is left is the arithmetic, which is what
 * has to match.
 */
const arithmetic = (source: string) =>
  code(source)
    .replaceAll(/\bstatic\b/g, "")
    // MSL passes the whole uniform block in; GLSL declares each uniform at file
    // scope and takes none. Same values, different way of reaching them.
    .replaceAll(", constant Uniforms &u", "")
    // The two languages' names for the two-argument arctangent.
    .replaceAll(/\batan2\b/g, "atan")
    .replaceAll(/\bfloat[234]?\b/g, "N")
    .replaceAll(/\bvec[234]\b/g, "N")
    .replaceAll(/\bblob_distance\b/g, "blobDistance")
    .replaceAll(/\bu\.(\w+)/g, (_, name: string) => `u_${name}`)
    .replaceAll(/\s+/g, " ")
    .trim();

describe("the outline both rasterisers draw", () => {
  it("bends by the same series on each side", () => {
    // The one shape a rasteriser *derives* rather than being handed: the plan
    // carries six harmonic coefficients and each side turns them into a curve.
    // Two slightly different curves is a preview and an export whose outlines
    // disagree — visible only by exporting and comparing.
    const glsl = body(SHADER_SOURCE().fragment, "float blobDistance(");
    const msl = body(METAL, "static float blob_distance(");

    expect(glsl, "blobDistance in the GLSL").not.toBeNull();
    expect(msl, "blob_distance in the MSL").not.toBeNull();
    expect(arithmetic(glsl!)).toBe(arithmetic(msl!));
  });

  it("mirrors the outline on each side", () => {
    // The camera is flipped by flipping its uv, which leaves an outline that
    // knows nothing about it facing the way the camera did while the person
    // faces the other. Done on one side only, the preview and the export put the
    // shape over opposite shoulders.
    for (const [name, source] of [
      ["the preview", body(SHADER_SOURCE().fragment, "float blobDistance(")],
      ["the exporter", body(METAL, "static float blob_distance(")],
    ] as const) {
      expect(arithmetic(source!), name).toContain("d.x = -d.x;");
    }
  });

  it("chooses the outline by its radius, on each side", () => {
    // The one that fails silently: a moment with nobody in front of the camera
    // has a presence of zero, and a side that fell back to the rounded rectangle
    // there would draw the whole uncropped camera picture across the frame for
    // as long as they were out of shot.
    expect(arithmetic(SHADER_SOURCE().fragment)).toContain("u_blob.z > 0.0 ? blobDistance");
    expect(arithmetic(METAL)).toContain("u_blob.z > 0.0 ? blobDistance");
  });
});
