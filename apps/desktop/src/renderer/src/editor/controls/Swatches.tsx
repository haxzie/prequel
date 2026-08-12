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

/**
 * A 5×3 grid of backgrounds to pick from.
 *
 * Fifteen cells either way, so both grids are the same shape and switching
 * between them does not move the controls underneath.
 */
const CELL =
  "relative aspect-square rounded border transition-transform hover:scale-110 " +
  "focus-visible:outline-2 focus-visible:outline-editor-accent focus-visible:outline-offset-1";

const GRID = "grid grid-cols-5 gap-1";

export function SolidSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  // A colour the user picked rather than one of the presets. Shown selected on
  // the picker cell, so the grid never looks as though nothing is chosen.
  const custom = !SOLID_PRESETS.some((preset) => preset.toLowerCase() === value.toLowerCase());

  return (
    <div className={GRID}>
      {SOLID_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          title={color}
          className={cn(
            CELL,
            color.toLowerCase() === value.toLowerCase()
              ? "border-editor-accent ring-1 ring-editor-accent"
              : "border-white/10",
          )}
          style={{ background: color }}
          onClick={() => onChange(color)}
        />
      ))}

      {/* The last cell is the escape hatch, drawn as a full hue wheel so it
          reads as "any colour" rather than as one more preset. The native input
          is stretched over it rather than sitting beside it — a separate hex
          field is a lot of chrome for something used rarely. */}
      <label
        className={cn(
          CELL,
          "cursor-pointer overflow-hidden",
          custom ? "border-editor-accent ring-1 ring-editor-accent" : "border-white/10",
        )}
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
          value={custom ? value : "#3b82f6"}
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
  value: Extract<Background, { kind: "gradient" }>;
  onChange: (gradient: GradientPreset) => void;
}) {
  return (
    <div className={GRID}>
      {GRADIENT_PRESETS.map((preset) => {
        const selected =
          preset.from.toLowerCase() === value.from.toLowerCase() &&
          preset.to.toLowerCase() === value.to.toLowerCase();

        return (
          <button
            key={preset.name}
            type="button"
            aria-label={preset.name}
            title={preset.name}
            className={cn(
              CELL,
              selected ? "border-editor-accent ring-1 ring-editor-accent" : "border-white/10",
            )}
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
 * Same cell, same five columns: switching between Solid, Gradient and Image
 * should change what is in the grid, not where the grid is — a different shape
 * per tab moves everything below it every time you look at another option.
 *
 * The desktop picture comes first because it is the default a project opens
 * with, so the selected cell is where the eye already is.
 */
export function ImageSwatches({
  path,
  wallpaper,
  onPickWallpaper,
  onPickPreset,
}: {
  /** The chosen image's file name inside the recording. */
  path: string;
  /** URL for the desktop picture inside the recording. */
  wallpaper: string | null;
  onPickWallpaper: () => void;
  onPickPreset: (presetId: string) => void;
}) {
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
          path === WALLPAPER_FILE_NAME
            ? "border-editor-accent ring-1 ring-editor-accent"
            : "border-white/10",
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
            path === preset.file
              ? "border-editor-accent ring-1 ring-editor-accent"
              : "border-white/10",
          )}
          // Drawn `cover` and centred, the same way the frame will draw it, so
          // the cell is a true sample of what lands behind the recording.
          style={{ backgroundImage: `url("${assetUrl(preset.file)}")` }}
          onClick={() => onPickPreset(preset.id)}
        />
      ))}
    </div>
  );
}
