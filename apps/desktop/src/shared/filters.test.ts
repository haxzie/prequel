/**
 * The catalogue, and the numbers it shares with a shader it cannot import.
 *
 * Two of these tests write out numbers that are also written out in
 * `crates/prequel-render/src/plan.rs`. That is deliberate and is the only guard
 * available: nothing compiles across the boundary, so a table on each side and
 * a test on each side naming the same numbers is what keeps them honest — the
 * same discipline `the_uniform_block_matches_the_shader` uses.
 */
import { describe, expect, it } from "vitest";

import {
  FILTERS,
  READY,
  filterId,
  filterSpec,
  isReady,
  variantIndex,
  type FilterId,
} from "./filters";
import { DEFAULT_EFFECTS } from "./project";

const ALL = Object.keys(FILTERS) as FilterId[];

describe("the catalogue", () => {
  it("gives every look a label and a hint", () => {
    // Including the ones with no shader yet. The copy is decided once, when the
    // id is, rather than in the sitting that adds the shader — which is the
    // sitting where a label like "CRT filter" gets typed.
    for (const id of ALL) {
      expect(FILTERS[id].label.length, id).toBeGreaterThan(0);
      expect(FILTERS[id].hint.length, id).toBeGreaterThan(0);
    }
  });

  it("only labels controls the look actually shows", () => {
    // `defaults` is deliberately complete — see the test below — but `labels`
    // must not be. A word written for a control the panel hides is dead copy:
    // it reads as a promise the look makes and nothing renders it, so nobody
    // finds out it was wrong.
    for (const id of ALL) {
      const spec = FILTERS[id];
      for (const param of Object.keys(spec.labels)) {
        expect(spec.uses.map(String), `${id}.${param}`).toContain(param);
      }
    }
  });

  it("names a variant the look has, or none at all", () => {
    for (const id of ALL) {
      const spec = FILTERS[id];
      if (spec.variants.length === 0) {
        // A look with one way of being worn stores an empty string rather than
        // a made-up name: the picker has nothing to show and the shader has
        // nothing to switch on.
        expect(spec.defaults.filterVariant, id).toBe("");
        continue;
      }
      expect(
        spec.variants.map((v) => v.id),
        id,
      ).toContain(spec.defaults.filterVariant);
    }
  });

  it("gives a look's variants distinct ids", () => {
    // Two variants sharing an id is a shader arm nothing can reach, and
    // `variantIndex` would quietly hand back the first of them.
    for (const id of ALL) {
      const ids = FILTERS[id].variants.map((v) => v.id);
      expect(new Set(ids).size, id).toBe(ids.length);
    }
  });

  it("defaults to every leaf the section carries", () => {
    // Every leaf, not only the ones the look reads. Choosing a look writes the
    // whole set, which is what stops a value dialled in for the last look
    // surviving underneath this one and reappearing the moment you switch back
    // — a control whose number changed while it was off screen.
    //
    // It is also what keeps `key in overrides.effects` answerable for every
    // leaf. A leaf added to `EffectsSettings` and forgotten here would have no
    // default to fall back to.
    const leaves = Object.keys(DEFAULT_EFFECTS).filter((key) => key !== "filter");
    for (const id of ALL) {
      expect(Object.keys(FILTERS[id].defaults).sort(), id).toEqual(leaves.sort());
    }
  });
});

describe("what this build can draw", () => {
  it("lists only looks that are in the catalogue", () => {
    for (const id of READY) expect(ALL).toContain(id);
  });

  it("has a shader behind every look in the catalogue", () => {
    // True today, and the reason `READY` still exists separately: it is what a
    // look is gated on while its shader is being written, so a half-finished
    // one can sit in the table with its id and copy decided without the picker
    // offering something that would draw nothing.
    for (const id of ALL) {
      expect(isReady(id), id).toBe(true);
      expect(filterSpec(id), id).not.toBeNull();
    }
  });

  it("offers every ready look, in the catalogue's own order", () => {
    // The picker renders `READY` rather than `FILTERS`, so a look added to the
    // table and forgotten here is a look nobody can reach.
    expect([...READY]).toEqual(ALL);
  });

  it("refuses a name it has never heard of, and no name", () => {
    // What a `project.json` from a newer build looks like from here.
    expect(filterSpec("hologram")).toBeNull();
    expect(filterId("hologram")).toBeNull();
    expect(filterSpec(null)).toBeNull();
    expect(filterSpec(undefined)).toBeNull();
    expect(filterSpec("")).toBeNull();
  });
});

describe("variant numbering", () => {
  /**
   * The table `FilterKind::variant_index` in
   * `crates/prequel-render/src/plan.rs` mirrors, written out.
   *
   * Every look with more than one way of being worn belongs here, in the order
   * its shader switches on. A look added to the catalogue with variants and not
   * added here fails the total below rather than silently drawing its first
   * variant in the export and its chosen one in the preview.
   */
  const NUMBERS: Partial<Record<FilterId, Record<string, number>>> = {
    grade: { warm: 0, cool: 1, faded: 2, mono: 3, sepia: 4, "teal-orange": 5 },
    halftone: { mono: 0, duotone: 1, cmyk: 2 },
    lcd: { "rgb-stripe": 0, "bgr-stripe": 1, "dot-matrix": 2 },
    fisheye: { barrel: 0, pincushion: 1, dome: 2 },
    crt: { grille: 0, "shadow-mask": 1, slot: 2 },
    film: { "16mm": 0, "35mm": 1, super8: 2 },
    "window-light": { blinds: 0, panes: 1, curtain: 2, leaves: 3 },
    dream: { mist: 0, halo: 1, rim: 2 },
  };

  it("matches the numbers the exporter holds", () => {
    for (const [id, expected] of Object.entries(NUMBERS)) {
      for (const [variant, index] of Object.entries(expected)) {
        expect(variantIndex(id as FilterId, variant), `${id}/${variant}`).toBe(index);
      }
    }
  });

  it("covers every look that has variants", () => {
    const withVariants = ALL.filter((id) => FILTERS[id].variants.length > 0);
    expect(withVariants.sort()).toEqual(Object.keys(NUMBERS).sort());
  });

  it("draws the first variant for a name it does not know", () => {
    // Rather than refusing. A variant this build does not have still names a
    // look it does, and the look drawn some way is better than a blank frame.
    for (const id of ALL) expect(variantIndex(id, "no-such-variant"), id).toBe(0);
  });
});
