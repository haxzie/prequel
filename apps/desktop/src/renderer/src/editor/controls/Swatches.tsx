import { BACKGROUND_PRESETS } from "../../../../shared/backgrounds";
import { assetUrl } from "../../../../shared/media-url";
import type { Background } from "../../../../shared/project";
import { WALLPAPER_FILE_NAME } from "../../../../shared/project";
import {
  gradientCss,
  GRADIENT_PRESETS,
  SOLID_PRESETS,
  type GradientPreset,
} from "../../../../shared/presets";
import { cn } from "../../lib/cn";
import { ImageIcon } from "../icons";

/**
 * One swatch in the five-column grid.
 *
 * The edge is a border and *only* a border. Selection used to add a `ring` in
 * the same colour on top of one, and a ring sits outside the border box — so
 * its corner radius is a pixel wider than the border's and the two arcs came
 * apart, which is what made every chosen swatch look like it had a second,
 * crooked outline around it.
 *
 * `bg-clip-padding` keeps the picture inside that edge. A translucent border
 * paints over the background by default, so on an image swatch the keyline
 * brightened and dimmed with whatever part of the photo it happened to cross.
 *
 * `hover:z-10` because the cell grows past its own grid track: without it the
 * swatches that come after it in the DOM paint over the enlarged edge.
 */
const CELL =
  "relative aspect-square rounded bg-clip-padding transition-transform " +
  "hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:outline-2 " +
  "focus-visible:outline-editor-accent focus-visible:outline-offset-1";

/**
 * Resting and chosen edges.
 *
 * The chosen one is thicker rather than merely brighter — `editor-accent` is a
 * pale grey, and one pixel of it against `white/10` is not a difference you can
 * find by scanning. Nothing moves: the box is border-box, so a second pixel of
 * border comes out of the swatch rather than out of the grid.
 */
const EDGE = "border border-white/10";
const EDGE_CHOSEN = "border-2 border-editor-accent";

const GRID = "grid grid-cols-5 gap-1";

export function SolidSwatches({
  value,
  onChange,
}: {
  /** The applied colour, or null when a solid is not what is applied. */
  value: string | null;
  onChange: (color: string) => void;
}) {
  // A colour the user picked rather than one of the presets. Shown chosen on
  // the picker cell, so the grid never looks as though nothing is set.
  const custom =
    value !== null && !SOLID_PRESETS.some((preset) => preset.toLowerCase() === value.toLowerCase());

  return (
    <div className={GRID}>
      {SOLID_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          title={color}
          aria-pressed={color.toLowerCase() === value?.toLowerCase()}
          className={cn(CELL, color.toLowerCase() === value?.toLowerCase() ? EDGE_CHOSEN : EDGE)}
          style={{ background: color }}
          onClick={() => onChange(color)}
        />
      ))}

      {/* The last cell is the escape hatch, drawn as a full hue wheel so it
          reads as "any colour" rather than as one more preset. The native input
          is stretched over it rather than sitting beside it — a separate hex
          field is a lot of chrome for something used rarely. */}
      <label
        className={cn(CELL, "cursor-pointer overflow-hidden", custom ? EDGE_CHOSEN : EDGE)}
        title="Custom colour"
        style={{
          background:
            "conic-gradient(#ff4444, #ffdd44, #44ff88, #44ddff, #4466ff, #cc44ff, #ff4488, #ff4444)",
        }}
      >
        <input
          type="color"
          aria-label="Custom colour"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={custom ? value! : "#3b82f6"}
          onChange={(event) => onChange(event.target.value)}
        />
        {/* A dot in the middle so the cell reads as a control rather than as a
            decorative rainbow tile. */}
        <span className="pointer-events-none absolute inset-0 m-auto size-1.5 rounded-full bg-white shadow" />
      </label>
    </div>
  );
}

export function GradientSwatches({
  value,
  onChange,
}: {
  /** The applied gradient, or null when a gradient is not what is applied. */
  value: Extract<Background, { kind: "gradient" }> | null;
  onChange: (gradient: GradientPreset) => void;
}) {
  return (
    <div className={GRID}>
      {GRADIENT_PRESETS.map((preset) => {
        const chosen =
          value !== null &&
          preset.from.toLowerCase() === value.from.toLowerCase() &&
          preset.to.toLowerCase() === value.to.toLowerCase();

        return (
          <button
            key={preset.name}
            type="button"
            aria-label={preset.name}
            title={preset.name}
            aria-pressed={chosen}
            className={cn(CELL, chosen ? EDGE_CHOSEN : EDGE)}
            style={{ background: gradientCss(preset) }}
            onClick={() => onChange(preset)}
          />
        );
      })}
    </div>
  );
}

/**
 * The image backgrounds, in the same grid as the colours.
 *
 * Same cell and the same five columns, so the swatches line up across the three
 * styles even though there are fewer pictures than colours and the grid is two
 * rows rather than three.
 *
 * The desktop picture comes first because it is the default a project opens
 * with, so the chosen cell is where the eye already is. Choosing a file of your
 * own is the last cell rather than a button under the grid: it is one more
 * background among the others, and a full-width button below them read as a
 * separate step you had to take before the grid would do anything.
 */
export function ImageSwatches({
  path,
  wallpaper,
  onPickWallpaper,
  onPickPreset,
  onPickImage,
}: {
  /** The applied image's file name, or null when an image is not applied. */
  path: string | null;
  /** URL for the desktop picture inside the recording. */
  wallpaper: string | null;
  onPickWallpaper: () => void;
  onPickPreset: (presetId: string) => void;
  onPickImage: () => void;
}) {
  // A file the user chose: an image is applied, and it is neither the desktop
  // picture nor one of the shipped ones.
  const own =
    path !== null &&
    path !== WALLPAPER_FILE_NAME &&
    !BACKGROUND_PRESETS.some((preset) => preset.file === path);

  return (
    <div className={GRID}>
      <button
        type="button"
        title="My wallpaper"
        aria-label="My wallpaper"
        aria-pressed={path === WALLPAPER_FILE_NAME}
        className={cn(
          CELL,
          "overflow-hidden bg-white/5 bg-cover bg-center",
          path === WALLPAPER_FILE_NAME ? EDGE_CHOSEN : EDGE,
        )}
        // The URL is built whether or not the file is there yet — the desktop
        // picture is only captured on demand. A background image that 404s
        // draws nothing, which leaves the cell as a plain swatch, and pressing
        // it is what triggers the capture. So: no loading state, no hiding it.
        style={wallpaper ? { backgroundImage: `url("${wallpaper}")` } : undefined}
        onClick={onPickWallpaper}
      />

      {BACKGROUND_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          title={preset.label}
          aria-label={preset.label}
          aria-pressed={path === preset.file}
          className={cn(
            CELL,
            "overflow-hidden bg-cover bg-center",
            path === preset.file ? EDGE_CHOSEN : EDGE,
          )}
          // Drawn `cover` and centred, the same way the frame will draw it, so
          // the cell is a true sample of what lands behind the recording.
          style={{ backgroundImage: `url("${assetUrl(preset.file)}")` }}
          onClick={() => onPickPreset(preset.id)}
        />
      ))}

      {/* A glyph rather than a sample, because there is nothing to sample yet.
          It stays chosen once a file is picked, so the grid still answers
          "which of these is applied" when the answer is not one of ours. */}
      <button
        type="button"
        title="Choose an image…"
        aria-label="Choose an image…"
        aria-pressed={own}
        className={cn(
          CELL,
          "grid place-items-center bg-white/5 text-editor-muted hover:text-editor-fg [&_svg]:size-4",
          own ? EDGE_CHOSEN : EDGE,
        )}
        onClick={onPickImage}
      >
        <ImageIcon />
      </button>
    </div>
  );
}
