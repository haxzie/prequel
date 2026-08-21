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
 * Two groups: photographs first, then gradients. The gradients are grainy on
 * purpose — a smooth ramp across a 4K frame bands visibly once it has been
 * through a video encoder, and the grain is the dither that stops it. Do not
 * re-encode them at a quality that smooths it away.
 *
 * Free of any `electron`, Node or DOM import: main resolves them to files, the
 * renderer resolves them to URLs, and both need the same list.
 */

export interface BackgroundPreset {
  id: string;
  label: string;
  /** File name inside `resources/backgrounds`, and inside a recording once
      copied there. */
  file: string;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: "monterey", label: "Monterey", file: "monterey.jpg" },
  { id: "sequoia", label: "Sequoia", file: "sequoia.jpg" },
  { id: "alpenglow", label: "Alpenglow", file: "alpenglow.jpg" },
  { id: "dune", label: "Dune", file: "dune.jpg" },
  { id: "canyon", label: "Canyon", file: "canyon.jpg" },
  { id: "cirrus", label: "Cirrus", file: "cirrus.jpg" },
  { id: "shore", label: "Shore", file: "shore.jpg" },
  { id: "aurora", label: "Aurora", file: "aurora.jpg" },
  { id: "iris", label: "Iris", file: "iris.jpg" },
  { id: "blush", label: "Blush", file: "blush.jpg" },
  { id: "nebula", label: "Nebula", file: "nebula.jpg" },
];

export function backgroundPreset(id: string): BackgroundPreset | undefined {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id);
}
