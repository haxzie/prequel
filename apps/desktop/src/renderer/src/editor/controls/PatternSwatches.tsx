/**
 * The drawn backgrounds: a grid of styles, and a row of colours under it.
 *
 * Two controls rather than one grid of every combination. Six styles across
 * eight palettes is forty-eight swatches, which is a wall rather than a
 * choice — and the two questions are independent, so they are asked
 * separately. Both apply on press; the one not pressed keeps what it was.
 *
 * The colours are the bottom row of the panel, where the blur slider sits on
 * the Image tab. Not blur as well: these are drawn at the frame's size, so
 * softening one is throwing away the only thing that makes it worth drawing,
 * and a grid is not a photograph that wants to recede.
 *
 * Every style tile is the real drawing, at tile size, **in the chosen
 * palette** — so pressing a colour repaints the grid above it rather than
 * only the frame. `wallpaperSvg` works from the shorter edge, so a tile is
 * the composition in miniature rather than a crop of it.
 */
import { wallpaperUrl } from "../wallpaper";
import type { WallpaperCatalogue, WallpaperSpec } from "../../../../shared/wallpapers";
import { cn } from "../../lib/cn";
import { Spinner } from "./BackgroundSwatch";

/** Big enough that the mat's rulers and numbers are legible in a tile. */
const STYLE_TILE = { width: 320, height: 200 };

const CELL =
  "relative overflow-hidden rounded-lg bg-clip-padding bg-cover transition-transform " +
  "hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:outline-2 " +
  "focus-visible:outline-editor-accent focus-visible:outline-offset-1";

const EDGE = "border border-white/7";
const EDGE_CHOSEN = "border-2 border-selected";

export function PatternSwatches({
  value,
  catalogue,
  pending,
  onChange,
}: {
  /** The applied recipe, or null when a pattern is not what is applied. */
  value: WallpaperSpec | null;
  catalogue: WallpaperCatalogue;
  /** The recipe being drawn right now, which is what carries the spinner. */
  pending: WallpaperSpec | null;
  onChange: (spec: WallpaperSpec) => void;
}) {
  const palette = chosenPalette(value, catalogue);

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {catalogue.styles.map((entry) => {
        const spec = { style: entry.id, palette };
        const chosen = value?.style === entry.id;

        return (
          <button
            key={entry.id}
            type="button"
            aria-label={entry.label}
            title={entry.label}
            aria-pressed={chosen}
            className={cn(CELL, "aspect-video", chosen ? EDGE_CHOSEN : EDGE)}
            style={{ backgroundImage: `url("${wallpaperUrl(spec, STYLE_TILE, catalogue)}")` }}
            onClick={() => onChange(spec)}
          >
            {/* The name over the picture rather than under it. A caption row
                  under each tile doubled the height of this grid to say six
                  words, and a mat is recognisable enough that the label is a
                  confirmation rather than the thing being read. */}
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1.5 py-0.5 text-[10px] text-white/90">
              {entry.label}
            </span>
            {busy(pending, spec) && <Cover />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The colours, as a row of them and nothing else.
 *
 * Two colours in each dot and not a miniature of the drawing: a mat at
 * eighteen pixels is a grey square, and what this row is for is telling olive
 * from rose at a glance. The surface fills it and the heavy rule is the ring,
 * which is the pair that decides what a pattern reads like.
 *
 * Separate from the grid above because it lives somewhere else on screen —
 * pinned at the foot of the panel, where the Image tab keeps its blur — and
 * the grid scrolls past it.
 */
export function PatternPalettes({
  value,
  catalogue,
  pending,
  onChange,
}: {
  value: WallpaperSpec | null;
  catalogue: WallpaperCatalogue;
  pending: WallpaperSpec | null;
  onChange: (spec: WallpaperSpec) => void;
}) {
  // The style a press here keeps. Falls back to the first, so the row works
  // before a pattern has been applied at all — pressing a colour then picks
  // the mat, which is the one everybody means by "that cutting board thing".
  const style = value?.style ?? catalogue.styles[0]?.id ?? "cutting-mat";

  return (
    <div className="flex items-center justify-between gap-1">
      {catalogue.palettes.map((entry) => {
        const spec = { style, palette: entry.id };
        const chosen = value?.palette === entry.id;

        return (
          <button
            key={entry.id}
            type="button"
            aria-label={entry.label}
            title={entry.label}
            aria-pressed={chosen}
            className={cn(
              "size-6 shrink-0 rounded-full transition-transform",
              "hover:scale-115 focus-visible:outline-2 focus-visible:outline-editor-accent",
              "focus-visible:outline-offset-2",
              // The chosen one is ringed outside itself rather than edged
              // inside: the ring *is* the palette's own colour on every other
              // dot, so an inner mark would be invisible on half of them.
              chosen && "ring-2 ring-selected ring-offset-2 ring-offset-editor-panel",
              busy(pending, spec) && "animate-pulse",
            )}
            style={{
              background: entry.surface,
              boxShadow: `inset 0 0 0 2px ${entry.rule}`,
            }}
            onClick={() => onChange(spec)}
          />
        );
      })}
    </div>
  );
}

/** Which palette the tiles are drawn in, applied or not. */
function chosenPalette(value: WallpaperSpec | null, catalogue: WallpaperCatalogue): string {
  return value?.palette ?? catalogue.palettes[0]?.id ?? "olive";
}

function busy(pending: WallpaperSpec | null, spec: WallpaperSpec): boolean {
  return pending?.style === spec.style && pending.palette === spec.palette;
}

/**
 * The wait while a tile is being drawn at output size.
 *
 * Short — a quarter of a second for a 4K mat — but not nothing, and a grid
 * that registers no press for a quarter of a second is one people press twice.
 */
function Cover() {
  return (
    <span className="absolute inset-0 grid place-items-center bg-black/40">
      <Spinner />
    </span>
  );
}
