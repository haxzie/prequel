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

import { CLICK_EFFECTS, CLICK_EFFECT_IDS } from "../../../shared/click-effects";
import { FILTER_SHADER_SOURCE } from "./filters";
import { SHADER_SOURCE } from "./webgl";

/**
 * Words GLSL ES 3.00 keeps for itself, from §3.6 of the specification.
 *
 * None of them does anything today; all of them are a compile error used as an
 * identifier. Several read as perfectly ordinary variable names — `cast`,
 * `filter`, `input`, `output`, `this`, `resource`, `patch`, `sample` — which is
 * exactly why they are worth a test rather than care.
 *
 * The list has to be the whole of §3.7 rather than the plausible-looking half of
 * it. `patch` was missing, a cover's local variable was called that, and the
 * fragment shader stopped compiling in its entirety — so the editor drew an
 * empty preview, every item gone, with one line in a log a packaged build has
 * no console for.
 */
const RESERVED = [
  "active",
  "asm",
  "atomic_uint",
  "attribute",
  "cast",
  "class",
  "coherent",
  "common",
  "double",
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
  "iimage1D",
  "iimage1DArray",
  "iimage2D",
  "iimage2DArray",
  "iimage3D",
  "iimageBuffer",
  "iimageCube",
  "image1D",
  "image1DArray",
  "image1DArrayShadow",
  "image1DShadow",
  "image2D",
  "image2DArray",
  "image2DArrayShadow",
  "image2DShadow",
  "image3D",
  "imageBuffer",
  "imageCube",
  "inline",
  "input",
  "interface",
  "long",
  "namespace",
  "noinline",
  "noperspective",
  "output",
  "partition",
  "patch",
  "prototype",
  "public",
  "readonly",
  "resource",
  "restrict",
  "sample",
  "sampler3DRect",
  "short",
  "sizeof",
  "static",
  "subroutine",
  "superp",
  "template",
  "this",
  "typedef",
  "uimage1D",
  "uimage1DArray",
  "uimage2D",
  "uimage2DArray",
  "uimage3D",
  "uimageBuffer",
  "uimageCube",
  "union",
  "unsigned",
  "using",
  "varying",
  "volatile",
  "writeonly",
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
      "LOUPE_CAUSTIC = 0.09",
      "LOUPE_CAUSTIC_DIR = N(0.5874, 0.8093)",
      "LOUPE_CAUSTIC_DROP = 0.95",
      "LOUPE_CAUSTIC_SPREAD = 0.85",
      "LOUPE_CAUSTIC_SAMPLE = 0.7",
      "LOUPE_CAUSTIC_TINT = 0.75",
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

/**
 * The spellings, and the uniform block MSL passes where GLSL has globals.
 *
 * The rim's distance field takes the block, so MSL names it in the signature and
 * at every call; GLSL reaches the same uniforms through file scope and names
 * none of them. `arithmetic` already sees through the signature — this is the
 * call sites, and the two languages' names for the same functions.
 */
const rim = (source: string) =>
  arithmetic(source)
    .replaceAll(/\bfield_distance\b/g, "fieldDistance")
    .replaceAll(/\bshape_distance\b/g, "shapeDistance")
    .replaceAll(/\brim_outward\b/g, "rimOutward")
    .replaceAll(/\brim_normal\b/g, "rimNormal")
    .replaceAll(/\brim_uv\b/g, "rimUv")
    .replaceAll(/\brim_lit\b/g, "rimLit")
    .replaceAll(/\blens_bend\b/g, "lensBend")
    .replaceAll(/\bhue_colour\b/g, "hueColour")
    .replaceAll(/\bmax_of\b/g, "maxOf")
    .replaceAll(", u)", ")");

/**
 * The glass rim both rasterisers draw.
 *
 * The lens's edge on the camera's own outline, and shading rather than geometry
 * for the same reason the lens is: the plan carries how wide the band is and
 * each side works out for itself where every pixel in it samples from and how
 * the light lands on it. Two slightly different edges is a bubble that is glass
 * on screen and plastic in the file — and the two are never side by side, so
 * nobody would see it until a frame of each was put next to the other.
 */
describe("the camera's glass rim", () => {
  it("measures the same distance field on each side", () => {
    // The one both the coverage and the rim read. A difference here is a bevel
    // on a different outline from the picture it is dressing.
    const glsl = body(SHADER_SOURCE().fragment, "float fieldDistance(");
    const msl = body(METAL, "static float field_distance(");

    expect(glsl, "fieldDistance in the GLSL").not.toBeNull();
    expect(msl, "field_distance in the MSL").not.toBeNull();
    expect(rim(glsl!)).toBe(rim(msl!));
  });

  it("finds which way the outline faces the same way on each side", () => {
    // Central differences, a pixel either side. Two different steps is glass
    // that rolls over a shade sooner in one rasteriser than the other, which
    // shows most on an outline fitted to somebody — the field with the steepest
    // slope on it.
    const glsl = body(SHADER_SOURCE().fragment, "vec2 rimOutward(");
    const msl = body(METAL, "static float2 rim_outward(");

    expect(glsl, "rimOutward in the GLSL").not.toBeNull();
    expect(msl, "rim_outward in the MSL").not.toBeNull();
    expect(rim(glsl!)).toBe(rim(msl!));
  });

  it("has the same surface on each side", () => {
    const glsl = body(SHADER_SOURCE().fragment, "vec3 rimNormal(");
    const msl = body(METAL, "static float3 rim_normal(");

    expect(glsl, "rimNormal in the GLSL").not.toBeNull();
    expect(msl, "rim_normal in the MSL").not.toBeNull();
    expect(rim(glsl!)).toBe(rim(msl!));
  });

  it("refracts the same way on each side", () => {
    // Where the band's squeeze comes from, and the fringing with it.
    const glsl = body(SHADER_SOURCE().fragment, "vec2 rimUv(");
    const msl = body(METAL, "static float2 rim_uv(");

    expect(glsl, "rimUv in the GLSL").not.toBeNull();
    expect(msl, "rim_uv in the MSL").not.toBeNull();
    expect(rim(glsl!)).toBe(rim(msl!));
  });

  it("lights the glass the same way on each side", () => {
    // The Fresnel term, the room it reflects and the glint. A difference here
    // is an edge that is brighter in the preview than in the file, which is
    // exactly the kind of thing that is only ever noticed after an export.
    const glsl = body(SHADER_SOURCE().fragment, "vec3 rimLit(");
    const msl = body(METAL, "static float3 rim_lit(");

    expect(glsl, "rimLit in the GLSL").not.toBeNull();
    expect(msl, "rim_lit in the MSL").not.toBeNull();
    expect(rim(glsl!)).toBe(rim(msl!));
  });

  it("is ground from the same glass on each side", () => {
    // The constants the two shaders cannot share, one being a template literal
    // in TypeScript and the other a Metal file.
    // The stretch and the spread are not among them: the rim is ground from the
    // lens's own, which the loupe's test already pins on both sides.
    for (const declaration of [
      "RIM_EDGE_FLAT = 0.2",
      "RIM_SHEEN = 0.22",
      "RIM_SPREAD = 0.04",
      "RIM_GLINT = 0.7",
      "RIM_SPECTRUM = 0.12",
      "RIM_TINT = 0.75",
      "RIM_FRINGE = 0.05",
      "RIM_FRINGE_FROM = 0.5",
    ]) {
      expect(rim(SHADER_SOURCE().fragment), `${declaration} in the GLSL`).toContain(declaration);
      expect(rim(METAL), `${declaration} in the MSL`).toContain(declaration);
    }
  });
});

/**
 * The spellings. The click section reads no uniform at all — that is the point
 * of it — so this is only the two languages' names for the same functions.
 */
const click = (source: string) =>
  arithmetic(source)
    .replaceAll(
      /\bclick_([a-z_]+)\b/g,
      (_, rest: string) =>
        "click" + rest.replaceAll(/(?:^|_)([a-z])/g, (_, c: string) => c.toUpperCase()),
    )
    .replaceAll(/\bhue_colour\b/g, "hueColour");

/**
 * The click marks both rasterisers draw.
 *
 * Shading alone, from the quad's own uv and a phase, so the plan carries
 * nothing but where and when — and each side draws the whole mark for itself.
 * A ring a few pixels wider in one, or a burst turned by a different seed, is
 * a preview and an export that disagree on every click, noticed only by
 * exporting and stepping through.
 */
describe("the click marks both rasterisers draw", () => {
  const PAIRS: [string, string][] = [
    ["float clickEaseOut(", "static float click_ease_out("],
    ["float clickBack(", "static float click_back("],
    ["float clickWrap(", "static float click_wrap("],
    ["float clickRing(", "static float click_ring("],
    ["float clickDisc(", "static float click_disc("],
    ["float clickHash(", "static float click_hash("],
    ["float clickHeart(", "static float click_heart("],
    ["vec4 clickRipple(", "static float4 click_ripple("],
    ["vec4 clickSonar(", "static float4 click_sonar("],
    ["vec4 clickOrb(", "static float4 click_orb("],
    ["vec4 clickPressure(", "static float4 click_pressure("],
    ["vec4 clickBurst(", "static float4 click_burst("],
    ["vec4 clickConfetti(", "static float4 click_confetti("],
    ["vec4 clickTarget(", "static float4 click_target("],
    ["vec4 clickHeartMark(", "static float4 click_heart_mark("],
    ["vec4 clickPixelRing(", "static float4 click_pixel_ring("],
    ["vec4 clickInk(", "static float4 click_ink("],
    ["vec4 clickHalo(", "static float4 click_halo("],
    ["vec4 clickTap(", "static float4 click_tap("],
    ["vec4 clickMark(", "static float4 click_mark("],
  ];

  it.each(PAIRS)("draws %s the same way on each side", (glslName, mslName) => {
    const glsl = body(SHADER_SOURCE().fragment, glslName);
    const msl = body(METAL, mslName);

    expect(glsl, `${glslName} in the GLSL`).not.toBeNull();
    expect(msl, `${mslName} in the MSL`).not.toBeNull();
    expect(click(glsl!)).toBe(click(msl!));
  });

  it("turns by the same circle on each side", () => {
    for (const source of [SHADER_SOURCE().fragment, METAL]) {
      expect(click(source)).toContain("CLICK_TAU = 6.2831853");
    }
  });

  it("gives every mark in the catalogue an arm on each side", () => {
    // The catalogue's numbers, switched on by name in both dispatchers. A mark
    // added to the table without an arm would be chosen in the picker and draw
    // nothing — in both rasterisers, so nothing would ever disagree, and
    // nobody would find out which number was missing.
    const glsl = body(SHADER_SOURCE().fragment, "vec4 clickMark(");
    const msl = body(METAL, "static float4 click_mark(");
    for (const id of CLICK_EFFECT_IDS) {
      const arm = `style == ${CLICK_EFFECTS[id].index}`;
      expect(glsl, `${id} in the GLSL`).toContain(arm);
      expect(msl, `${id} in the MSL`).toContain(arm);
    }
  });
});
