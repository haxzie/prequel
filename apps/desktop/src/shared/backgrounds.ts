/**
 * The wallpapers offered as background presets.
 *
 * Shipped with the app rather than fetched, so the picker works offline and a
 * background never changes under an edit that was already made with it.
 *
 * Chosen for what a screen recording sits on: dark or low-contrast, nothing
 * with detail fine enough to compete with the text in the footage. They are
 * drawn centred and scaled to cover, so the middle of each one is what will be
 * seen in a square or vertical frame — which is why the busiest part of each is
 * near the centre.
 *
 * Grouped, because a single grid of these is a wall rather than a choice:
 * `Wallpapers` are the pictures, `Aurora` the dark saturated glows,
 * `Soft Light` the pale pastel ones, and `Glass` the refracted and faceted
 * ones. The picker adds a `Custom` section of its own after these, holding the
 * file picker — it has no presets, so it is not a category here. The order of `BACKGROUND_CATEGORIES` is the
 * order the picker shows them in, and a preset's `category` is the only thing
 * that decides where it lands — moving one is a one-word edit.
 *
 * The gradients are grainy on purpose — a smooth ramp across a 4K frame bands
 * visibly once it has been through a video encoder, and the grain is the dither
 * that stops it. Do not re-encode them at a quality that smooths it away.
 *
 * Free of any `electron`, Node or DOM import: main resolves them to files, the
 * renderer resolves them to URLs, and both need the same list.
 */

/** The groups the picker shows, in the order it shows them. */
export const BACKGROUND_CATEGORIES = ["wallpapers", "aurora", "softlight", "glass"] as const;

export type BackgroundCategory = (typeof BACKGROUND_CATEGORIES)[number];

/** What each group is called on screen. */
export const BACKGROUND_CATEGORY_LABELS: Record<BackgroundCategory, string> = {
  wallpapers: "Wallpapers",
  aurora: "Aurora",
  softlight: "Soft Light",
  glass: "Glass",
};

export interface BackgroundPreset {
  id: string;
  label: string;
  /** File name inside `resources/backgrounds`, and inside a recording once
      copied there. */
  file: string;
  category: BackgroundCategory;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  // Somewhere real, or drawn to look like it.
  { id: "monterey", label: "Monterey", file: "monterey.jpg", category: "wallpapers" },
  { id: "sequoia", label: "Sequoia", file: "sequoia.jpg", category: "wallpapers" },
  { id: "alpenglow", label: "Alpenglow", file: "alpenglow.jpg", category: "wallpapers" },
  { id: "dune", label: "Dune", file: "dune.jpg", category: "wallpapers" },
  { id: "canyon", label: "Canyon", file: "canyon.jpg", category: "wallpapers" },
  { id: "cirrus", label: "Cirrus", file: "cirrus.jpg", category: "wallpapers" },
  { id: "shore", label: "Shore", file: "shore.jpg", category: "wallpapers" },

  // Grainy gradient glows, which is what an aurora looks like once it is a
  // background rather than a photograph.
  { id: "aurora", label: "Aurora", file: "aurora.jpg", category: "aurora" },
  { id: "iris", label: "Iris", file: "iris.jpg", category: "aurora" },
  { id: "nebula", label: "Nebula", file: "nebula.jpg", category: "aurora" },
  { id: "blush", label: "Blush", file: "blush.jpg", category: "aurora" },
  { id: "indigo", label: "Indigo", file: "indigo.jpg", category: "aurora" },
  { id: "cobalt", label: "Cobalt", file: "cobalt.jpg", category: "aurora" },
  { id: "lilac", label: "Lilac", file: "lilac.jpg", category: "aurora" },
  { id: "dusk", label: "Dusk", file: "dusk.jpg", category: "aurora" },
  { id: "ember", label: "Ember", file: "ember.jpg", category: "aurora" },
  { id: "sage", label: "Sage", file: "sage.jpg", category: "aurora" },

  // Pale and low-contrast. These arrived perfectly smooth — a flat patch
  // measured 0.3 where the rest of the catalogue measures nearly 3 — so grain
  // was added when they were brought in, for the banding reason above. Judge
  // any replacement the same way rather than by eye: the encoder is what
  // decides, and it does so after the file looks fine.
  { id: "peony", label: "Peony", file: "peony.jpg", category: "softlight" },
  { id: "reef", label: "Reef", file: "reef.jpg", category: "softlight" },
  { id: "meadow", label: "Meadow", file: "meadow.jpg", category: "softlight" },
  { id: "linen", label: "Linen", file: "linen.jpg", category: "softlight" },
  { id: "bluebell", label: "Bluebell", file: "bluebell.jpg", category: "softlight" },
  { id: "apricot", label: "Apricot", file: "apricot.jpg", category: "softlight" },
  { id: "sherbet", label: "Sherbet", file: "sherbet.jpg", category: "softlight" },
  { id: "fern", label: "Fern", file: "fern.jpg", category: "softlight" },
  { id: "glacier", label: "Glacier", file: "glacier.jpg", category: "softlight" },
  { id: "orchid", label: "Orchid", file: "orchid.jpg", category: "softlight" },

  // Light through something: refracted, faceted, ribbed. Dark, so the footage
  // in front of them carries the frame.
  { id: "prism", label: "Prism", file: "prism.jpg", category: "glass" },
  { id: "caustic", label: "Caustic", file: "caustic.jpg", category: "glass" },
  { id: "facet", label: "Facet", file: "facet.jpg", category: "glass" },
  { id: "fluted", label: "Fluted", file: "fluted.jpg", category: "glass" },
  { id: "reeded", label: "Reeded", file: "reeded.jpg", category: "glass" },
];

/** The presets in one group, in catalogue order. */
export function backgroundsIn(category: BackgroundCategory): BackgroundPreset[] {
  return BACKGROUND_PRESETS.filter((preset) => preset.category === category);
}

export function backgroundPreset(id: string): BackgroundPreset | undefined {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id);
}
