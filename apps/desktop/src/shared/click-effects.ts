/**
 * The catalogue of marks a click can leave on the picture.
 *
 * A mark is drawn at the spot that was clicked, for the moment after, in both
 * the preview and the export. It is a shader arm on each side — `clickMark` in
 * `editor/webgl.ts` and `click_mark` in `crates/prequel-render/src/shaders.metal`
 * — and this file is the table both panels and the plan are interpreted
 * through. There are no image assets: a mark is arithmetic on the quad's own
 * uv, which is what lets it take any colour and any size without a loader on
 * either side.
 *
 * Deliberately free of any DOM, Node or React import: the editor builds its
 * picker from this, `layout.ts` resolves a plan from it, and both have to work
 * in a test with neither.
 *
 * ## Why the plan carries the id and not the arm
 *
 * The shader switches on a number, and that number is worked out on each side
 * from the id — `index` here, `ClickEffect::index` in `plan.rs` — the way a
 * filter's look index is. Stored as a number, an arm inserted in the middle of
 * the list would make every saved project draw some *other* mark; stored as a
 * name, a mark this build does not ship draws nothing, which is the right
 * answer for a project written by a newer one. The two tables are pinned by a
 * test on each side naming the same numbers, because nothing compiles across
 * the boundary.
 */

/** Every mark, by the name that travels in a plan and in `project.json`. */
export type ClickEffectId =
  | "ripple"
  | "sonar"
  | "orb"
  | "pressure"
  | "burst"
  | "confetti"
  | "target"
  | "heart"
  | "pixel-ring"
  | "ink"
  | "halo"
  | "tap";

export interface ClickEffectSpec {
  label: string;
  /**
   * A sentence for the picker's tooltip. Plain and short, like the rest of the
   * editor's copy — what it looks like, not what it is doing.
   */
  hint: string;
  /**
   * Which arm of `clickMark` draws it. Never renumbered: the plan carries the
   * id, so a renumbering costs nothing on disk — but `shaders.metal` and
   * `plan.rs` both hold this number by hand, and a renumbering there that is
   * not made here draws the wrong mark in one rasteriser only.
   */
  index: number;
  /**
   * The colour the mark starts in, as hex.
   *
   * Written alongside the id when a mark is chosen, the way a filter's
   * defaults are: a like is red and ink is dark, and arriving at a mark in
   * the colour that makes it itself beats arriving at one that happens to be
   * white. The colour is the user's from then on — choosing the same mark
   * again does not put it back.
   */
  color: string;
  /**
   * How long the mark is on screen, in nanoseconds from the press.
   *
   * The mark's own rather than a control: each one is shaped around its
   * length — a ripple that ran for two seconds would be a slow bubble, not a
   * ripple — and a slider over it would make every mark wrong at both ends.
   */
  duration: number;
}

const MS = 1_000_000;

export const CLICK_EFFECTS: Record<ClickEffectId, ClickEffectSpec> = {
  ripple: {
    label: "Ripple",
    hint: "A ring spreads out and fades.",
    index: 0,
    // White reads on a light page and a dark one.
    color: "#ffffff",
    duration: 450 * MS,
  },
  sonar: {
    label: "Sonar",
    hint: "Three rings, one after another.",
    index: 1,
    // A radar's blue.
    color: "#5ac8fa",
    duration: 700 * MS,
  },
  orb: {
    label: "Orb",
    hint: "A soft dot blooms and goes.",
    index: 2,
    // A warm glow.
    color: "#ffd60a",
    duration: 300 * MS,
  },
  pressure: {
    label: "Press",
    hint: "A ring closes onto the click.",
    index: 3,
    // White reads on a light page and a dark one.
    color: "#ffffff",
    duration: 400 * MS,
  },
  burst: {
    label: "Burst",
    hint: "Lines fly out like a comic pow.",
    index: 4,
    // A comic's orange.
    color: "#ff9f0a",
    duration: 500 * MS,
  },
  confetti: {
    label: "Confetti",
    hint: "A handful of bits thrown up.",
    index: 5,
    // The bits each shift away from this, so a pink spreads into the whole wheel.
    color: "#ff2d55",
    duration: 700 * MS,
  },
  target: {
    label: "Target",
    hint: "A crosshair snaps in and fades.",
    index: 6,
    // A scope's red.
    color: "#ff453a",
    duration: 500 * MS,
  },
  heart: {
    label: "Heart",
    hint: "A like: a burst, a heart, and dots flying out.",
    index: 7,
    // The red everyone has seen under a tweet.
    color: "#e0245e",
    duration: 800 * MS,
  },
  "pixel-ring": {
    label: "Pixel",
    hint: "A chunky 8-bit ring.",
    index: 8,
    // A terminal's green.
    color: "#30d158",
    duration: 450 * MS,
  },
  ink: {
    label: "Ink",
    hint: "A splat that soaks away.",
    index: 9,
    // Dark enough to read as ink, light enough to show on a dark page.
    color: "#5e5ce6",
    duration: 600 * MS,
  },
  halo: {
    label: "Halo",
    hint: "A glow breathes around the click.",
    index: 10,
    // White reads on a light page and a dark one.
    color: "#ffffff",
    duration: 500 * MS,
  },
  tap: {
    label: "Tap",
    hint: "A fingertip, touch-screen style.",
    index: 11,
    // A fingertip on glass is colourless.
    color: "#ffffff",
    duration: 300 * MS,
  },
};

/** The ids in the order the picker shows them: the quiet ones first. */
export const CLICK_EFFECT_IDS = Object.keys(CLICK_EFFECTS) as ClickEffectId[];

/** What a project stores to draw no mark. */
export const NO_CLICK_EFFECT = "none";

/**
 * The spec for a stored id, or null for "none" and for a name this build does
 * not ship.
 *
 * Null rather than a throw, the way `cursorStyle()` falls back: a project
 * written by a newer build can name a mark this one has never heard of, and
 * the right answer is a plain click rather than an editor that will not open.
 */
export function clickEffect(id: string | null | undefined): ClickEffectSpec | null {
  if (!id || id === NO_CLICK_EFFECT) return null;
  // Own keys only: a stored id of "toString" is a mark too, otherwise.
  if (!Object.hasOwn(CLICK_EFFECTS, id)) return null;
  return CLICK_EFFECTS[id as ClickEffectId];
}

/** The same, narrowed to what may be stored, for the places that store one. */
export function clickEffectId(
  id: string | null | undefined,
): ClickEffectId | typeof NO_CLICK_EFFECT {
  return clickEffect(id) ? (id as ClickEffectId) : NO_CLICK_EFFECT;
}
