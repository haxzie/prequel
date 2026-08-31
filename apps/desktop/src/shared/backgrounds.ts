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
 * Grouped, because eleven swatches in one grid is a wall rather than a choice:
 * `Wallpapers` are the photographs, `Aurora` the grainy gradient glows, and
 * `Lights` the graphic studies. The order of `BACKGROUND_CATEGORIES` is the
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
export const BACKGROUND_CATEGORIES = ["wallpapers", "aurora", "lights"] as const;

export type BackgroundCategory = (typeof BACKGROUND_CATEGORIES)[number];

/** What each group is called on screen. */
export const BACKGROUND_CATEGORY_LABELS: Record<BackgroundCategory, string> = {
  wallpapers: "Wallpapers",
  aurora: "Aurora",
  lights: "Lights",
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
  // Photographs of somewhere real.
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

  // Drawn light rather than photographed: rays and a lit ridge.
  { id: "sequoia", label: "Sequoia", file: "sequoia.jpg", category: "lights" },
  { id: "monterey", label: "Monterey", file: "monterey.jpg", category: "lights" },
];

/** The presets in one group, in catalogue order. */
export function backgroundsIn(category: BackgroundCategory): BackgroundPreset[] {
  return BACKGROUND_PRESETS.filter((preset) => preset.category === category);
}

export function backgroundPreset(id: string): BackgroundPreset | undefined {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id);
}
