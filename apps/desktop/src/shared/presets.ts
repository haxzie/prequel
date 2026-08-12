/**
 * Output frame sizes.
 *
 * Dimensions rather than bare ratios, because the number that matters is the
 * one that ends up in the file — a "9:16" that exports at 405×720 is not what
 * anyone uploading to a phone-shaped feed wants.
 *
 * Deliberately free of any `electron` or Node import: main persists these and
 * the renderer draws them.
 */

export interface FramePreset {
  id: string;
  label: string;
  /** Shown under the label, e.g. "1080 × 1920". */
  group: "General" | "Social";
  width: number;
  height: number;
}

export const FRAME_PRESETS: FramePreset[] = [
  { id: "16:9", label: "Landscape 16:9", group: "General", width: 1920, height: 1080 },
  { id: "16:9-4k", label: "Landscape 4K", group: "General", width: 3840, height: 2160 },
  { id: "9:16", label: "Vertical 9:16", group: "General", width: 1080, height: 1920 },
  { id: "1:1", label: "Square 1:1", group: "General", width: 1080, height: 1080 },
  { id: "4:5", label: "Portrait 4:5", group: "General", width: 1080, height: 1350 },

  { id: "youtube", label: "YouTube", group: "Social", width: 1920, height: 1080 },
  { id: "shorts", label: "YouTube Shorts", group: "Social", width: 1080, height: 1920 },
  { id: "tiktok", label: "TikTok", group: "Social", width: 1080, height: 1920 },
  { id: "reels", label: "Instagram Reels", group: "Social", width: 1080, height: 1920 },
  { id: "instagram", label: "Instagram Feed", group: "Social", width: 1080, height: 1350 },
  { id: "x", label: "X", group: "Social", width: 1920, height: 1080 },
  { id: "linkedin", label: "LinkedIn", group: "Social", width: 1920, height: 1080 },
];

/**
 * The frame follows the recording rather than a fixed size.
 *
 * Not in `FRAME_PRESETS`, because it has no dimensions of its own — the editor
 * fills them in from the screen track when a recording opens. Kept as an id on
 * the frame rather than as a flag so "which option is selected" stays one
 * question with one answer.
 */
export const AUTO_PRESET_ID = "auto";

/**
 * What a new project opens on.
 *
 * The recording's own size, so the footage fits the frame end to end and the
 * first thing anyone sees is what they recorded rather than a letterboxed
 * version of it.
 */
export const DEFAULT_PRESET_ID = AUTO_PRESET_ID;

export function findPreset(id: string | null): FramePreset | undefined {
  return id === null ? undefined : FRAME_PRESETS.find((preset) => preset.id === id);
}

/**
 * The preset matching a size exactly, if there is one.
 *
 * Several presets share dimensions — YouTube and X are both 1920×1080 — so a
 * size alone cannot identify which was chosen. That is why the project stores
 * the id as well, and why this is only used to label a size that arrived
 * without one.
 */
export function presetForSize(width: number, height: number): FramePreset | undefined {
  return FRAME_PRESETS.find((preset) => preset.width === width && preset.height === height);
}

/** Frame sizes must be even: H.264 chroma subsampling cannot encode an odd edge. */
export function evenSize(value: number, min = 16, max = 7680): number {
  return Math.min(Math.max(Math.round(value), min), max) & ~1;
}

/**
 * Solid background colours.
 *
 * Fourteen, so the fifteenth cell of the 5×3 grid can be the colour picker and
 * the last row is not left half-empty. A spread of neutrals first — most screen
 * recordings want to sit on something quiet — then one saturated option per
 * hue, with no two close enough to be mistaken for each other at swatch size.
 */
export const SOLID_PRESETS: string[] = [
  "#0f1115",
  "#1c1e22",
  "#3a3f47",
  "#6b7280",
  "#e5e7eb",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#10b981",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

export interface GradientPreset {
  name: string;
  from: string;
  to: string;
  angle: number;
}

/**
 * Gradient backgrounds.
 *
 * Drawn from uiGradients, filtered to pairs with enough separation to still
 * read as a gradient once a screen recording is sitting on top of them —
 * near-monochrome pairs go flat behind content, which is the whole failure mode
 * of a gradient background.
 *
 * Fifteen, filling the 5×3 grid exactly, and no custom option: a two-colour
 * gradient is easy to make ugly and the presets are the point.
 */
export const GRADIENT_PRESETS: GradientPreset[] = [
  { name: "Ibtesam", from: "#00f5a0", to: "#00d9f5", angle: 135 },
  { name: "Lunada", from: "#5433ff", to: "#20bdff", angle: 135 },
  { name: "Bloody Mary", from: "#ff512f", to: "#dd2476", angle: 135 },
  { name: "Sunrise", from: "#ff512f", to: "#f09819", angle: 135 },
  { name: "Electric Violet", from: "#4776e6", to: "#8e54e9", angle: 135 },
  { name: "Aqua Marine", from: "#1a2980", to: "#26d0ce", angle: 135 },
  { name: "Mojito", from: "#1d976c", to: "#93f9b9", angle: 135 },
  { name: "Juicy Orange", from: "#ff8008", to: "#ffc837", angle: 135 },
  { name: "Intuitive Purple", from: "#da22ff", to: "#9733ee", angle: 135 },
  { name: "Stripe", from: "#1fa2ff", to: "#a6ffcb", angle: 135 },
  { name: "Instagram", from: "#833ab4", to: "#fcb045", angle: 135 },
  { name: "JShine", from: "#12c2e9", to: "#f64f59", angle: 135 },
  { name: "Endless River", from: "#43cea2", to: "#185a9d", angle: 135 },
  { name: "Mantle", from: "#24c6dc", to: "#514a9d", angle: 135 },
  { name: "Omolon", from: "#091e3a", to: "#2f80ed", angle: 135 },
];

/** The CSS a gradient preset paints as, for a swatch. */
export function gradientCss(gradient: { from: string; to: string; angle: number }): string {
  return `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`;
}
