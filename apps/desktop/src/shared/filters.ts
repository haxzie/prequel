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
   * Whether the shader reads a level of the scene's mip chain other than the
   * top — the glow spreading highlights, the fish eye losing focus at the rim.
   *
   * The preview builds that chain per frame and only for the looks that use it;
   * the other nine would pay for one nothing samples. Set this on a look whose
   * shader starts sampling a level and the chain appears; forget to, and it
   * falls back to the sharp top level rather than to black — see the note in
   * `webgl.ts`'s `draw`.
   */
  blurs: boolean;
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

export const FILTERS: Record<FilterId, FilterSpec> = {
  aberration: {
    label: "Chromatic aberration",
    hint: "Colour splitting towards the edges, the way a cheap lens does it.",
    uses: ["strength", "angle"],
    labels: { strength: "Split", angle: "Direction" },
    variants: [],
    blurs: false,
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

  grade: {
    label: "Colour",
    hint: "A grade over the whole frame — warm, cool, faded, mono.",
    uses: ["strength", "variant"],
    labels: { strength: "Amount", variant: "Grade" },
    variants: [
      { id: "warm", label: "Warm" },
      { id: "cool", label: "Cool" },
      { id: "faded", label: "Faded" },
      { id: "mono", label: "Mono" },
      { id: "sepia", label: "Sepia" },
      { id: "teal-orange", label: "Teal & orange" },
    ],
    blurs: false,
    defaults: { ...NO_LOOK, filterStrength: 0.7, filterVariant: "warm" },
  },

  pixelate: {
    label: "Pixelate",
    hint: "Square blocks, or dithered down to two colours.",
    uses: ["scale", "variant"],
    labels: { scale: "Block size", variant: "Style" },
    variants: [
      { id: "blocks", label: "Blocks" },
      { id: "bayer", label: "Dither" },
    ],
    // Coarse enough to read as a choice. A block a pixel wide is the original
    blurs: false,
    // picture with the frame time of a filter.
    defaults: { ...NO_LOOK, filterScale: 0.012, filterVariant: "blocks" },
  },

  halftone: {
    label: "Halftone",
    hint: "Printed dots on a ruled screen.",
    uses: ["strength", "scale", "angle", "tint", "variant"],
    labels: {
      strength: "Amount",
      scale: "Dot pitch",
      angle: "Screen",
      tint: "Ink",
      variant: "Ink set",
    },
    variants: [
      { id: "mono", label: "One ink" },
      { id: "duotone", label: "Duotone" },
      { id: "cmyk", label: "CMYK" },
    ],
    blurs: false,
    defaults: {
      ...NO_LOOK,
      filterStrength: 1,
      filterScale: 0.006,
      // 45 degrees, which is where a single screen goes: on the diagonal the
      // grid stops lining up with anything in the picture and reads as tone
      // rather than as a pattern laid over it.
      filterAngle: 45,
      filterTint: "#1c1c1e",
      filterVariant: "mono",
    },
  },

  lcd: {
    label: "LCD",
    hint: "A subpixel grid with a lifted black, the way a panel looks close up.",
    uses: ["strength", "scale", "tint", "variant"],
    labels: { strength: "Amount", scale: "Pixel size", tint: "Backlight", variant: "Panel" },
    variants: [
      { id: "rgb-stripe", label: "RGB" },
      { id: "bgr-stripe", label: "BGR" },
      { id: "dot-matrix", label: "Dot matrix" },
    ],
    blurs: false,
    defaults: {
      ...NO_LOOK,
      // Not the whole way. At full strength the grid is the subject and the
      // recording is what it is laid over; a little under, and the panel reads
      // as something the picture is being shown *on*.
      filterStrength: 0.85,
      // As with the CRT's triad: fine enough to read as a panel, coarse enough
      // that a pixel's three stripes each land on more than one of the
      // output's.
      filterScale: 0.009,
      filterTint: "#8fb9d6",
      filterVariant: "rgb-stripe",
    },
  },

  fisheye: {
    label: "Fish eye",
    hint: "Bulged through a wide lens.",
    uses: ["strength", "scale", "variant"],
    labels: { strength: "Bulge", scale: "Edge zoom", variant: "Lens" },
    variants: [
      { id: "barrel", label: "Barrel" },
      { id: "pincushion", label: "Pincushion" },
      { id: "dome", label: "Peephole" },
    ],
    blurs: true,
    defaults: { ...NO_LOOK, filterStrength: 0.6, filterScale: 0.02, filterVariant: "barrel" },
  },

  crt: {
    label: "CRT",
    hint: "Curved glass, an aperture grille, and a slow rolling bar.",
    uses: ["strength", "scale", "angle", "tint", "animated", "variant"],
    labels: {
      strength: "Amount",
      scale: "Triad pitch",
      angle: "Tilt",
      tint: "Phosphor",
      animated: "Refresh bar",
      variant: "Mask",
    },
    variants: [
      { id: "grille", label: "Grille" },
      { id: "shadow-mask", label: "Shadow mask" },
      { id: "slot", label: "Slot mask" },
    ],
    blurs: false,
    defaults: {
      ...NO_LOOK,
      filterStrength: 0.85,
      // Eight thousandths of the shorter edge: about nine pixels a triad at
      // 1080p, so each phosphor gets three and the grille is a grille rather
      // than a guess. Finer than this and even the export cannot resolve it.
      filterScale: 0.008,
      // White, so the tube is colourless until somebody asks for amber or
      // green. The control is there for exactly those two.
      filterTint: "#ffffff",
      filterVariant: "grille",
    },
  },

  vhs: {
    label: "VHS",
    hint: "Chroma bleed, line jitter and a tear along the bottom.",
    uses: ["strength", "scale", "animated"],
    labels: { strength: "Wear", scale: "Line height", animated: "Tracking" },
    variants: [],
    blurs: false,
    defaults: { ...NO_LOOK, filterStrength: 0.7, filterScale: 0.003, filterAnimated: true },
  },

  film: {
    label: "Film",
    hint: "Grain, halation and a little weave in the gate.",
    uses: ["strength", "scale", "tint", "animated", "variant"],
    labels: {
      strength: "Amount",
      scale: "Grain size",
      tint: "Halation",
      animated: "Gate weave",
      variant: "Stock",
    },
    variants: [
      { id: "16mm", label: "16mm" },
      { id: "35mm", label: "35mm" },
      { id: "super8", label: "Super 8" },
    ],
    blurs: false,
    defaults: {
      ...NO_LOOK,
      filterStrength: 0.8,
      filterScale: 0.003,
      // The warm bleed a bright highlight leaves on film stock.
      filterTint: "#ff9a5c",
      filterVariant: "16mm",
      filterAnimated: true,
    },
  },

  bloom: {
    label: "Glow",
    hint: "Highlights blooming out into what is around them.",
    uses: ["strength", "scale", "tint"],
    labels: { strength: "Amount", scale: "Radius", tint: "Colour" },
    variants: [],
    blurs: true,
    defaults: { ...NO_LOOK, filterStrength: 0.6, filterScale: 0.02, filterTint: "#ffffff" },
  },

  "window-light": {
    label: "Window light",
    hint: "Light through blinds, panes, a curtain, or leaves.",
    uses: ["strength", "scale", "angle", "tint", "variant"],
    labels: {
      strength: "Contrast",
      scale: "Spacing",
      angle: "Direction",
      tint: "Sunlight",
      variant: "Through",
    },
    variants: [
      { id: "blinds", label: "Blinds" },
      { id: "panes", label: "Panes" },
      { id: "curtain", label: "Curtain" },
      { id: "leaves", label: "Leaves" },
    ],
    blurs: false,
    defaults: {
      ...NO_LOOK,
      filterStrength: 0.75,
      filterScale: 0.06,
      filterAngle: 20,
      // Late afternoon. A neutral "sunlight" is a contradiction, and the whole
      // reason this reads as light rather than as a grey overlay is that the
      // lit side warms while the shadow cools.
      filterTint: "#ffd9a0",
      filterVariant: "blinds",
    },
  },
};

/** The looks with a shader behind them, in the order the picker shows them. */
export const READY: readonly FilterId[] = [
  "aberration",
  "grade",
  "pixelate",
  "halftone",
  "lcd",
  "fisheye",
  "crt",
  "vhs",
  "film",
  "bloom",
  "window-light",
];

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
