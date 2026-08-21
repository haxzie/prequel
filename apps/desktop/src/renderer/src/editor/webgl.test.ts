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
import { describe, expect, it } from "vitest";

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

describe("the shaders", () => {
  const sources = Object.entries(SHADER_SOURCE());

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
