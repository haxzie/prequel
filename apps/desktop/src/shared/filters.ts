/**
 * The catalogue of looks a clip can wear, and what each one reads.
 *
 * A filter is one pass over the *finished* frame — background, screen, camera
 * and captions together — so it is not a property of any one picture and does
 * not belong in `layout`. It has its own settings section, and this file is the
 * table that section is interpreted through.
 *
 * Deliberately free of any DOM, Node or React import: the editor builds its
 * panel from this, `layout.ts` resolves a plan from it, and both have to work
 * in a test with neither.
 *
 * ## Why one shared vocabulary rather than leaves per effect
 *
 * Every effect reads from the same six leaves — a strength, a variant, a size,
 * an angle, a tint, and whether the moving parts move. Eleven effects with four
 * leaves each would be forty, thirty-six of them dead for whatever is chosen:
 * dead weight in every resolved settings object, every saved preset, and every
 * Reset key table, and forty answers to "is this overridden?" where the user
 * can only see four.
 *
 * The cost is that the leaves mean different things per effect, which is what
 * `labels` and `uses` are for — the panel shows only the controls the chosen
 * look reads, under that look's own words, so "Scale" is never what anyone
 * sees.
 */

/** Every look, by the name that travels in a plan and in `project.json`. */
export type FilterId =
  | "aberration"
  | "grade"
  | "pixelate"
  | "halftone"
  | "lcd"
  | "fisheye"
  | "crt"
  | "vhs"
  | "film"
  | "bloom"
  | "window-light";

/** One of the shared leaves, named without its `filter` prefix. */
export type FilterParam = "strength" | "variant" | "scale" | "angle" | "tint" | "animated";

export interface FilterVariant {
  /** Travels in the plan. Never renumbered — see `variantIndex`. */
  id: string;
  label: string;
}

export interface FilterSpec {
  label: string;
  /**
   * A sentence for the picker's tooltip. Plain and short, like the rest of the
   * editor's copy — what it looks like, not what it is doing.
   */
  hint: string;
  /** Which shared leaves this look reads. Everything else stays hidden. */
  uses: readonly FilterParam[];
  /** What each leaf is called here. A missing entry falls back to the leaf. */
  labels: Partial<Record<FilterParam, string>>;
  /**
   * The sub-looks. Empty when there is only one way to wear it, which is what
   * hides the control even though `uses` may name it.
   */
  variants: readonly FilterVariant[];
  /**
   * What choosing this look writes alongside its id.
   *
   * Written in one edit with the id, the way `freshFraming` moves the camera
   * when the arrangement changes: a strength dialled in for a halftone means
   * something else entirely to a fisheye, and arriving at a look that is
   * obviously itself beats arriving at one that happens to be invisible.
   */
  defaults: FilterDefaults;
}

/** The shared leaves, without the section wrapper. Mirrors `EffectsSettings`
    minus `filter`, which is the thing being chosen. */
export interface FilterDefaults {
  filterStrength: number;
  filterVariant: string;
  filterScale: number;
  filterAngle: number;
  filterTint: string;
  filterAnimated: boolean;
}

/**
 * How far a shared leaf can be pushed.
 *
 * One range for all eleven rather than one per effect: the leaf is the same
 * leaf, and a slider whose ends moved when the look changed would make the
 * number under your finger mean something new every time. What differs between
 * effects is where the *default* sits, which is `defaults` above.
 *
 * `scale` is a fraction of the frame's shorter edge, so the bottom of its range
 * is about a pixel at 1080p and the top is a fifth of the picture — a scanline
 * at one end and a window blind at the other.
 */
export const FILTER_SCALE_MIN = 0.001;
export const FILTER_SCALE_MAX = 0.2;

const NO_LOOK: FilterDefaults = {
  filterStrength: 0.5,
  filterVariant: "",
  filterScale: 0.01,
  filterAngle: 0,
  filterTint: "#ffffff",
  filterAnimated: false,
};

/**
 * A catalogue entry that has no shader yet.
 *
 * Present in the table from the start so the id, the label and the copy are
 * decided once, and so `FilterId` is the whole list rather than a list that
 * grows — which would make every `Record<FilterId, …>` elsewhere a moving
 * target. `READY` is what the picker filters on.
 *
 * Declared above `FILTERS` rather than below it: the table calls this while it
 * is being built, and `NO_LOOK` is a `const`. Hoisting covers the function and
 * not the constant, so the other order throws before the module has finished
 * loading — which reads as the editor failing to open.
 */
function pending(label: string, hint: string): FilterSpec {
  return { label, hint, uses: [], labels: {}, variants: [], defaults: NO_LOOK };
}

export const FILTERS: Record<FilterId, FilterSpec> = {
  aberration: {
    label: "Chromatic aberration",
    hint: "Colour splitting towards the edges, the way a cheap lens does it.",
    uses: ["strength", "angle"],
    labels: { strength: "Split", angle: "Direction" },
    variants: [],
    defaults: {
      // Enough to see at a glance on a still frame without reading as a fault.
      // Real lateral aberration is a pixel or two at the corner of a good lens
      // and ten at the corner of a bad one; this sits nearer the bad one,
      // because somebody reaching for this effect is reaching for the look.
      filterStrength: 0.35,
      filterVariant: "",
      filterScale: 0.01,
      // Radial, which is what a lens actually does. The angle biases it towards
      // a lateral split; zero leaves it alone.
      filterAngle: 0,
      filterTint: "#ffffff",
      filterAnimated: false,
    },
  },

  // The rest of the catalogue arrives in later phases. Each is an entry here, a
  // branch in `filters.ts`'s GLSL and the same branch in `filters.metal` — no
  // structural change, which is the point of the shared vocabulary.
  grade: pending("Colour", "A grade over the whole frame — warm, cool, faded, mono."),
  pixelate: pending("Pixelate", "Square blocks, or dithered down to two colours."),
  halftone: pending("Halftone", "Printed dots on a ruled screen."),
  lcd: pending("LCD", "A subpixel grid with a lifted black, the way a panel looks close up."),
  fisheye: pending("Fish eye", "Bulged through a wide lens."),
  crt: pending("CRT", "Curved glass, an aperture grille, and a slow rolling bar."),
  vhs: pending("VHS", "Chroma bleed, line jitter and a tear along the bottom."),
  film: pending("Film", "Grain, halation and a little weave in the gate."),
  bloom: pending("Glow", "Highlights blooming out into what is around them."),
  "window-light": pending("Window light", "Light through blinds, panes, a curtain, or leaves."),
};

/** The looks with a shader behind them, in the order the picker shows them. */
export const READY: readonly FilterId[] = ["aberration"];

/** Whether a look can actually be drawn in this build. */
export function isReady(id: FilterId): boolean {
  return READY.includes(id);
}

/**
 * The look by that name, or null.
 *
 * Null rather than a throw, and by the same reasoning `cursorStyle` and
 * `captionStyle` fall back: a `project.json` or a published preset from a newer
 * build can name a filter this one has never heard of, and the right answer is
 * the clip drawn plainly rather than an editor that will not open it.
 */
export function filterSpec(id: string | null | undefined): FilterSpec | null {
  if (!id) return null;
  const spec = (FILTERS as Record<string, FilterSpec | undefined>)[id];
  return spec && isReady(id as FilterId) ? spec : null;
}

/** The same, narrowed to the id, for the places that store one. */
export function filterId(id: string | null | undefined): FilterId | null {
  return filterSpec(id) ? (id as FilterId) : null;
}

/**
 * Which arm of the shader's variant switch this name is.
 *
 * A number, because a shader has no strings — but the number is derived here
 * and never stored, so the names in `project.json` stay the stable thing and a
 * variant inserted in the middle of a list costs nothing but a recompile.
 *
 * `crates/prequel-render/src/plan.rs` holds the same table as a `match`, and
 * the two are kept honest by a test on each side naming the same numbers. That
 * is the same hand-kept mirror `the_uniform_block_matches_the_shader` is, and
 * for the same reason: nothing can compile across the boundary.
 *
 * An unknown name is 0 rather than an error. A variant this build does not have
 * draws the look's first one, which is a look; refusing would be a blank frame.
 */
export function variantIndex(id: FilterId, variant: string): number {
  const found = FILTERS[id].variants.findIndex((v) => v.id === variant);
  return found < 0 ? 0 : found;
}
