/**
 * The background the app ships, and the only one it can draw with no network.
 *
 * Everything else lives in R2 and arrives through the catalogue — see
 * `main/backgrounds.ts` and the backgrounds skill. This list is the floor
 * underneath that: what the picker falls back to when there is neither a cached
 * catalogue nor a connection, and the only name `assetPath` will serve.
 *
 * It is one picture, and it is `monterey.jpg`, because that is what
 * `DEFAULT_BACKGROUND` opens a fresh project on. Shipping none at all would
 * leave the first recording made on a machine with no network drawing nothing
 * where its background should be. Shipping all thirty-two cost forty megabytes
 * of bundle for a picker most people touch once.
 *
 * Keep this in step with `resources/backgrounds`: `sync-backgrounds.mjs` copies
 * exactly these files, `assetPath` refuses a name that is not here, and
 * `backgrounds.test.ts` fails if a preset has no file behind it.
 *
 * Free of any `electron`, Node or DOM import: main resolves them to files, the
 * renderer resolves them to URLs, and both need the same list.
 */

/**
 * The groups the shipped floor is shown in.
 *
 * Only the floor's. A hosted catalogue carries its own order and labels, and
 * `useBackgrounds` walks those instead — so this shrinking does not take the
 * Aurora, Soft Light and Glass headings off the picker for anyone online.
 */
export const BACKGROUND_CATEGORIES = ["wallpapers"] as const;

export type BackgroundCategory = (typeof BACKGROUND_CATEGORIES)[number];

/** What each group is called on screen. */
export const BACKGROUND_CATEGORY_LABELS: Record<BackgroundCategory, string> = {
  wallpapers: "Wallpapers",
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
  { id: "monterey", label: "Monterey", file: "monterey.jpg", category: "wallpapers" },
];

/** The presets in one group, in catalogue order. */
export function backgroundsIn(category: BackgroundCategory): BackgroundPreset[] {
  return BACKGROUND_PRESETS.filter((preset) => preset.category === category);
}

export function backgroundPreset(id: string): BackgroundPreset | undefined {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id);
}
