import type { LayoutSettings, LayoutPreset } from "../../../../shared/project";
import { DEFAULT_BACKGROUND, DEFAULT_LAYOUT } from "../../../../shared/project";
import { layoutBoxes, type Size } from "../../../../shared/layout";
import { PersonIcon } from "../icons";
import { cn } from "../../lib/cn";

/**
 * The arrangement, as a grid of the shapes it makes.
 *
 * Ten small pictures rather than a list of names. "Padded screen with the
 * camera beside it, matched to its height" is a sentence nobody reads twice; the
 * same thing as two rectangles is understood before it is finished being looked
 * at, and the grid is scanned rather than read.
 *
 * Every thumbnail is drawn by asking `layoutBoxes` where the pictures go and
 * scaling the answer down. Drawing them by hand would be a second
 * implementation of the layout, and it would be wrong the first time a rule
 * changed — silently, in the one place whose whole job is to promise what the
 * export will look like.
 */

/** The arrangements, in the order they appear. Five to a row. */
const PRESETS: { value: LayoutPreset; label: string; camera: boolean }[] = [
  { value: "over-full", label: "Full screen, camera over", camera: true },
  { value: "over-padded", label: "Padded screen, camera over", camera: true },
  { value: "beside", label: "Screen and camera side by side", camera: true },
  { value: "stacked", label: "Screen above the camera", camera: true },
  { value: "split", label: "Split down the middle", camera: true },
  { value: "split-stacked", label: "Split across the middle", camera: true },
  { value: "screen-full", label: "Screen only, full frame", camera: false },
  { value: "screen-padded", label: "Screen only, padded", camera: false },
  { value: "camera-full", label: "Camera only, full frame", camera: true },
  { value: "camera-padded", label: "Camera only, padded", camera: true },
];

/**
 * The proportions the thumbnails draw the screen at.
 *
 * The recording's real shape is not worth threading in here: `beside` sizes the
 * screen off its aspect, and a thumbnail drawn from a 16:9 assumption is the
 * right picture for all but a hand-cropped region. What it must never do is
 * disagree about *which* arrangement it is showing, and it cannot.
 */
const THUMB_SOURCES = { screen: { width: 16, height: 9 }, camera: { width: 16, height: 9 } };

// Square, so the cell is the same size whatever shape the output frame is and
// the grid does not reflow when someone switches to a vertical preset.
const CELL =
  "relative grid aspect-square place-items-center rounded-md bg-white/5 p-0.5 " +
  "hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30";

export function LayoutPicker({
  frame,
  value,
  cameraPresent,
  onChange,
}: {
  frame: Size;
  value: LayoutPreset;
  /**
   * Arrangements needing a camera are disabled without one, not hidden. A grid
   * that changes shape depending on the recording is a grid nobody learns, and
   * the empty space would be the only clue that anything was missing.
   */
  cameraPresent: boolean;
  onChange: (preset: LayoutPreset) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {PRESETS.map((preset) => {
        const off = preset.camera && !cameraPresent;

        return (
          <button
            key={preset.value}
            type="button"
            aria-label={preset.label}
            title={preset.label}
            aria-pressed={preset.value === value}
            disabled={off}
            className={cn(CELL, preset.value === value && "ring-2 ring-editor-accent ring-inset")}
            onClick={() => onChange(preset.value)}
          >
            <Plate frame={frame} preset={preset.value} />
          </button>
        );
      })}

      {/* Only while it is the state. `custom` is not something to pick — it is
          where a resize lands — so a cell offering it would be an arrangement
          that does nothing when clicked. Shown when it applies so the picker
          always has an answer to "which one is this". */}
      {value === "custom" && (
        <button
          type="button"
          aria-label="Custom"
          title="Custom — dragged by hand"
          aria-pressed
          className={cn(CELL, "ring-2 ring-editor-accent ring-inset")}
          onClick={() => onChange("custom")}
        >
          <span className="text-[9px] text-editor-muted">Custom</span>
        </button>
      )}
    </div>
  );
}

/** One thumbnail: the frame, with whichever pictures the arrangement puts in it. */
function Plate({ frame, preset }: { frame: Size; preset: LayoutPreset }) {
  // A frame of arbitrary size, laid out and then expressed as percentages, so
  // the plate is resolution-independent and needs no measuring.
  const boxes = layoutBoxes(
    frame,
    { ...DEFAULT_LAYOUT, preset } as LayoutSettings,
    DEFAULT_BACKGROUND,
    THUMB_SOURCES,
  );

  const at = (box: { x: number; y: number; width: number; height: number }) => ({
    left: `${(box.x / frame.width) * 100}%`,
    top: `${(box.y / frame.height) * 100}%`,
    width: `${(box.width / frame.width) * 100}%`,
    height: `${(box.height / frame.height) * 100}%`,
  });

  return (
    <span
      className="relative block overflow-hidden rounded-[3px] bg-black/40"
      // Whichever edge runs out first, so a 9:16 frame draws as a tall sliver
      // inside a square cell rather than overflowing it.
      style={{
        aspectRatio: `${frame.width} / ${frame.height}`,
        width: frame.width >= frame.height ? "100%" : undefined,
        height: frame.width >= frame.height ? undefined : "100%",
      }}
    >
      {boxes.screen && (
        <span className="absolute rounded-[2px] bg-editor-fg/70" style={at(boxes.screen.area)} />
      )}
      {boxes.camera && (
        <span
          className={cn(
            "absolute grid place-items-center overflow-hidden bg-layout-camera text-white/90",
            // The bubble reads as a bubble at this size only if it is round.
            boxes.camera.card ? "rounded-[2px]" : "rounded-full",
            // Both edges, so the glyph stays square and centres itself inside
            // whatever shape the block is — a tall column in `beside`, a wide
            // band in `stacked`. `meet` is the SVG default and does the rest.
            "[&>svg]:h-[75%] [&>svg]:w-[75%]",
          )}
          style={at(boxes.camera.area)}
        >
          {/* Says which block is the camera without anyone having to learn
              that blue means camera. It is a mark rather than a picture in the
              smallest cells — the bubble is nine pixels across there — but a
              blue block with something in it still reads differently from the
              plain one beside it. */}
          <PersonIcon />
        </span>
      )}
    </span>
  );
}
