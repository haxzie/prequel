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

/**
 * The lens both rasterisers draw.
 *
 * The loupe is shading, not geometry: the plan carries where the glass is and how
 * strong it is, and each side works out for itself where every pixel inside it
 * samples from. Two slightly different refractions is a preview whose lens
 * magnifies by a shade more than the export's — and the two are never on screen
 * together, so nobody would see it until a frame of one was put beside a frame of
 * the other.
 *
 * The spellings are the only difference allowed: `lensNormal` here,
 * `lens_normal` there.
 */
const lens = (source: string) =>
  arithmetic(source)
    .replaceAll(/\blens_normal\b/g, "lensNormal")
    .replaceAll(/\blens_bend\b/g, "lensBend")
    .replaceAll(/\blens_tap\b/g, "lensTap")
    .replaceAll("texture2d<N> backdrop, sampler smp, ", "")
    .replaceAll(/\bbehind\(backdrop, smp, u, /g, "behind(")
    .replaceAll(/\blens_reach\b/g, "lensReach");

describe("the camera's colour look", () => {
  it("grades the same way on each side", () => {
    // The catalogue is data and lives in one file, so the two shaders cannot
    // disagree about what a look *is*. They can still disagree about what the
    // numbers mean, which is what this covers — and it would show as a face
    // that is one colour in the preview and another in the file, noticed after
    // the export.
    const glsl = body(SHADER_SOURCE().fragment, "vec3 graded(");
    const msl = body(METAL, "static float3 graded(");

    expect(glsl, "graded in the GLSL").not.toBeNull();
    expect(msl, "graded in the MSL").not.toBeNull();
    expect(grade(glsl!)).toBe(grade(msl!));
  });

  it("builds a hue the same way on each side", () => {
    const glsl = body(SHADER_SOURCE().fragment, "vec3 hueColour(");
    const msl = body(METAL, "static float3 hue_colour(");

    expect(glsl, "hueColour in the GLSL").not.toBeNull();
    expect(msl, "hue_colour in the MSL").not.toBeNull();
    expect(grade(glsl!)).toBe(grade(msl!));
  });

  it("puts skin in the same place on each side", () => {
    // Where a webcam puts skin, which is what the vibrance protects. Two
    // different points is a grade that spares the face in one rasteriser and
    // drives it orange in the other.
    for (const [name, source] of [
      ["the preview", SHADER_SOURCE().fragment],
      ["the exporter", METAL],
    ] as const) {
      expect(grade(source), name).toContain("SKIN = N(0.19, 0.08)");
    }
  });
});

/** The two spellings, and nothing else between the grading functions. */
const grade = (source: string) =>
  arithmetic(source)
    .replaceAll(/\bhue_colour\b/g, "hueColour")
    .replaceAll(/\bmax_of\b/g, "maxOf")
    .replaceAll(/\bmin_of\b/g, "minOf");

describe("enlarging a picture", () => {
  it("snaps to the texel grid the same way on each side", () => {
    // The filter every magnified draw goes through — a camera zoom as well as a
    // lens. A difference here is a preview and an export that disagree about how
    // sharp the same zoom is, which is only findable by exporting and comparing.
    const glsl = body(SHADER_SOURCE().fragment, "vec4 sampleEnlarged(");
    const msl = body(METAL, "static float4 sample_enlarged(");

    expect(glsl, "sampleEnlarged in the GLSL").not.toBeNull();
    expect(msl, "sample_enlarged in the MSL").not.toBeNull();
    expect(enlarge(glsl!)).toBe(enlarge(msl!));
  });

  it("measures the sampling rate the same way on each side", () => {
    const glsl = body(SHADER_SOURCE().fragment, "float texelsPerPixel(");
    const msl = body(METAL, "static float texels_per_pixel(");

    expect(glsl, "texelsPerPixel in the GLSL").not.toBeNull();
    expect(msl, "texels_per_pixel in the MSL").not.toBeNull();
    expect(enlarge(glsl!)).toBe(enlarge(msl!));
  });
});

/**
 * The two spellings, and the arguments MSL passes where GLSL has globals.
 *
 * MSL takes the texture, the sampler and the uniform block as parameters; GLSL
 * declares all three at file scope and names none of them. Same values, same
 * arithmetic, different way of reaching them — which is exactly what this has
 * to see through.
 */
const enlarge = (source: string) =>
  arithmetic(source)
    .replaceAll(/\bsample_enlarged\b/g, "sampleEnlarged")
    .replaceAll(/\btexels_per_pixel\b/g, "texelsPerPixel")
    .replaceAll(/\bimage\.sample\(smp, /g, "texture(u_image, ")
    .replaceAll("texture2d<N> image, sampler smp, ", "")
    .replaceAll("constant Uniforms &u, ", "");

describe("the loupe both rasterisers draw", () => {
  it("has the same surface on each side", () => {
    const glsl = body(SHADER_SOURCE().fragment, "vec3 lensNormal(");
    const msl = body(METAL, "static float3 lens_normal(");

    expect(glsl, "lensNormal in the GLSL").not.toBeNull();
    expect(msl, "lens_normal in the MSL").not.toBeNull();
    expect(lens(glsl!)).toBe(lens(msl!));
  });

  it("smears its contents the same way on each side", () => {
    // How much of the glass's travel a given pixel sees depends on how far into
    // the lens it is. Two answers to that is a preview whose lens smears by a
    // different amount from the export's, on exactly the frames where something
    // is moving and nobody is looking closely.
    const glsl = body(SHADER_SOURCE().fragment, "vec3 lensTap(");
    const msl = body(METAL, "static float3 lens_tap(");

    expect(glsl, "lensTap in the GLSL").not.toBeNull();
    expect(msl, "lens_tap in the MSL").not.toBeNull();
    expect(lens(glsl!)).toBe(lens(msl!));
  });

  it("refracts the same way on each side", () => {
    // Where the magnification actually comes from. A difference here is a lens
    // that joins the picture at the rim in one and leaves a seam in the other.
    const glsl = body(SHADER_SOURCE().fragment, "float lensReach(");
    const msl = body(METAL, "static float lens_reach(");

    expect(glsl, "lensReach in the GLSL").not.toBeNull();
    expect(msl, "lens_reach in the MSL").not.toBeNull();
    expect(lens(glsl!)).toBe(lens(msl!));
  });

  it("is ground from the same glass on each side", () => {
    // The constants the two shaders cannot share, since one is a template
    // literal in TypeScript and the other a Metal file. The index and the
    // dispersion decide the mapping; the bleed has to agree with the quad the
    // plan grew, or the shadow is clipped on one side only.
    for (const declaration of [
      "LOUPE_BLEED = 0.22",
      "LOUPE_IOR = 1.52",
      "LOUPE_LIGHT = N(-0.4508, -0.6211, 0.6411)",
      "LOUPE_ROLL = 0.995",
      "LOUPE_EDGE_FLAT = 0.08",
      "LOUPE_EDGE_FULL = 0.55",
      "LOUPE_REACH = 1.75",
      "LOUPE_STRETCH = 0.42",
      "LOUPE_SMEAR_TAPS = 5",
      "LOUPE_SPREAD = 0.2",
    ]) {
      expect(lens(SHADER_SOURCE().fragment), `${declaration} in the GLSL`).toContain(declaration);
      expect(lens(METAL), `${declaration} in the MSL`).toContain(declaration);
    }
  });
});
