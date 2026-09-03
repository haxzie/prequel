import type { CSSProperties } from "react";

import type {
  Background,
  BackgroundSettings,
  LayoutSettings,
  LayoutPreset,
} from "../../../../shared/project";
import { DEFAULT_LAYOUT } from "../../../../shared/project";
import { gradientCss } from "../../../../shared/presets";
import { layoutBoxes, presetFitsFrame, type Size } from "../../../../shared/layout";
import { PersonIcon } from "../icons";
import { cn } from "../../lib/cn";

/**
 * The arrangement, as a grid of the shapes it makes.
 *
 * Fourteen small pictures rather than a list of names. "Padded screen with the
 * camera beside it, matched to its height" is a sentence nobody reads twice; the
 * same thing as two rectangles is understood before it is finished being looked
 * at, and the grid is scanned rather than read.
 *
 * Grouped by what the arrangement puts in the frame, because that is the order
 * the choice is actually made in: what is in the picture first, how it is
 * arranged second. As fourteen unlabelled cells in one block, the camera-only
 * arrangements read as three more variations on the eight above them.
 *
 * Each arrangement sits next to its own reflection, so the pair is read as one
 * choice with a side to it rather than as two arrangements that happen to look
 * alike.
 *
 * Every thumbnail is drawn by asking `layoutBoxes` where the pictures go and
 * scaling the answer down. Drawing them by hand would be a second
 * implementation of the layout, and it would be wrong the first time a rule
 * changed — silently, in the one place whose whole job is to promise what the
 * export will look like.
 *
 * The composition's own background goes behind them, and its own padding sets
 * the inset. Both used to be the defaults: a padded arrangement then drew its
 * gap in near-black against a near-black plate, so the six arrangements that
 * differ from their neighbours *only* by that gap were six copies of the same
 * picture — and a project whose padding had been turned up or off was described
 * by a thumbnail that showed neither.
 */

/**
 * The arrangements, in the order they appear. Four to a row.
 *
 * `camera` sits on the group rather than on each arrangement: it is the same
 * question the heading already answers, and two places to state it is one place
 * for them to disagree.
 *
 * Each label still says in full what the cell is, rather than leaning on the
 * heading above it. A heading is not associated with the buttons under it, so
 * "Full frame" alone is what a screen reader would announce, twice, in two
 * different groups.
 */
const GROUPS: {
  id: string;
  label: string;
  /** Needs a camera track, so the whole group greys out without one. */
  camera: boolean;
  presets: { value: LayoutPreset; label: string }[];
}[] = [
  {
    id: "both",
    label: "Screen and camera",
    camera: true,
    presets: [
      { value: "over-full", label: "Full screen, camera over" },
      { value: "over-padded", label: "Padded screen, camera over" },
      { value: "over-column", label: "Padded screen, camera standing over its right end" },
      { value: "over-column-left", label: "Padded screen, camera standing over its left end" },
      { value: "beside", label: "Screen and camera side by side, camera at the right" },
      { value: "beside-left", label: "Screen and camera side by side, camera at the left" },
      { value: "stacked", label: "Screen above the camera" },
      { value: "split", label: "Split down the middle" },
    ],
  },
  {
    id: "camera",
    label: "Camera only",
    camera: true,
    presets: [
      { value: "camera-full", label: "Camera only, full frame" },
      { value: "camera-padded", label: "Camera only, padded" },
      { value: "camera-inset", label: "Camera only, standing further back" },
    ],
  },
  {
    id: "screen",
    label: "Screen only",
    camera: false,
    presets: [
      { value: "screen-full", label: "Screen only, full frame" },
      { value: "screen-padded", label: "Screen only, padded" },
      { value: "screen-inset", label: "Screen only, standing further back" },
    ],
  },
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

/**
 * The least padding a thumbnail will draw, whatever the composition's is.
 *
 * A deliberate and narrow lie. Everywhere else these plates are exact, because
 * a picker that promises one thing and exports another is worse than no picker
 * — but a plate is about forty pixels tall, and the default 0.06 of the shorter
 * edge comes to a pixel and a half on it. At that size "padded" and "full
 * frame" are the same picture, and two cells that cannot be told apart are a
 * worse failure than a gap drawn wider than it will be.
 *
 * Only a floor: turn the padding up and the thumbnail follows it exactly, which
 * is the case anyone actually checks a thumbnail against.
 */
const THUMB_MIN_PADDING = 0.1;

// Square, so the cell is the same size whatever shape the output frame is and
// the grid does not reflow when someone switches to a vertical preset.
const CELL =
  "relative grid aspect-square place-items-center rounded-md bg-white/5 p-0.5 " +
  "hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30";

const GRID = "grid grid-cols-4 gap-1";

export function LayoutPicker({
  frame,
  background,
  fileUrl,
  value,
  cameraPresent,
  onChange,
}: {
  frame: Size;
  /** The composition's background and padding, drawn as they will be. */
  background: BackgroundSettings;
  /** Resolves a file inside the recording, for an image background. */
  fileUrl: (file: string) => string;
  value: LayoutPreset;
  /**
   * Arrangements needing a camera are disabled without one, not hidden. A grid
   * that changes shape depending on the recording is a grid nobody learns, and
   * the empty space would be the only clue that anything was missing.
   */
  cameraPresent: boolean;
  onChange: (preset: LayoutPreset) => void;
}) {
  // Worked out once for all fourteen cells: it is the same background in each,
  // and an image URL rebuilt per cell is fourteen identical requests for the
  // browser to deduplicate.
  const paint = backgroundCss(background.background, fileUrl);

  return (
    <div className="flex flex-col gap-2">
      {GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <h3 className="text-[10px] font-medium text-editor-muted">{group.label}</h3>

          <div className={GRID}>
            {group.presets.map((preset) => {
              // Disabled for the same reason a camera arrangement is without a
              // camera: the cell stays where it is, and the label says why it
              // cannot be picked. An arrangement that disappeared when the
              // frame was made vertical would take the grid's shape with it,
              // and leave nothing to explain where it went.
              const fits = presetFitsFrame(preset.value, frame);
              const label = fits
                ? preset.label
                : `${preset.label} — needs a frame wider than it is tall`;

              return (
                <button
                  key={preset.value}
                  type="button"
                  aria-label={label}
                  title={label}
                  aria-pressed={preset.value === value}
                  disabled={(group.camera && !cameraPresent) || !fits}
                  className={cn(
                    CELL,
                    preset.value === value && "ring-2 ring-editor-accent ring-inset",
                  )}
                  onClick={() => onChange(preset.value)}
                >
                  <Plate
                    frame={frame}
                    preset={preset.value}
                    background={background}
                    paint={paint}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Its own group rather than a cell tacked onto the last one, following
          the background picker: `custom` is not something to pick — it is where
          a resize lands — so a cell offering it among the arrangements would be
          one that does nothing when clicked. Shown only while it is the state,
          so the picker always has an answer to "which one is this". */}
      {value === "custom" && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] font-medium text-editor-muted">Custom</h3>

          <div className={GRID}>
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
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A background as CSS.
 *
 * The same three cases `toPaint` maps for the rasterisers, in the one language
 * a swatch can be painted in. `cover` and centred because that is how both of
 * them draw an image, so the cell samples what the frame will show.
 */
function backgroundCss(background: Background, fileUrl: (file: string) => string): CSSProperties {
  switch (background.kind) {
    case "solid":
      return { background: background.color };
    case "gradient":
      return { background: gradientCss(background) };
    case "image":
      return {
        backgroundImage: `url("${fileUrl(background.path)}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
  }
}

/** One thumbnail: the frame, with whichever pictures the arrangement puts in it. */
function Plate({
  frame,
  preset,
  background,
  paint,
}: {
  frame: Size;
  preset: LayoutPreset;
  background: BackgroundSettings;
  paint: CSSProperties;
}) {
  // A frame of arbitrary size, laid out and then expressed as percentages, so
  // the plate is resolution-independent and needs no measuring.
  const boxes = layoutBoxes(
    frame,
    { ...DEFAULT_LAYOUT, preset } as LayoutSettings,
    // Floored, and only for the geometry — see `THUMB_MIN_PADDING`. The paint
    // below still comes from the composition's own background untouched.
    { ...background, padding: Math.max(background.padding, THUMB_MIN_PADDING) },
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
      //
      // The paint goes on last so an image that has not loaded — or one the
      // recording never copied in — leaves the dark plate underneath rather
      // than a transparent hole in the middle of the grid.
      style={{
        aspectRatio: `${frame.width} / ${frame.height}`,
        width: frame.width >= frame.height ? "100%" : undefined,
        height: frame.width >= frame.height ? undefined : "100%",
        ...paint,
      }}
    >
      {boxes.screen && (
        <span className="absolute rounded-[2px] bg-layout-screen" style={at(boxes.screen.area)} />
      )}
      {boxes.camera && (
        <span
          className={cn(
            "absolute grid place-items-center overflow-hidden bg-layout-camera text-black/50",
            // The bubble reads as a bubble at this size only if it is round.
            boxes.camera.card ? "rounded-[2px]" : "rounded-full",
            // Both edges, so the glyph stays square and centres itself inside
            // whatever shape the block is — a tall column in `beside`, a wide
            // band in `stacked`. `meet` is the SVG default and does the rest.
            "[&>svg]:h-[75%] [&>svg]:w-[75%]",
          )}
          style={at(boxes.camera.area)}
        >
          {/* Says which block is the camera, and with both blocks now grey it
              is the only thing that does. Dark on the lighter grey rather than
              white: the block is a mid tone, and white on it is the pairing
              that stops reading at this size. */}
          <PersonIcon />
        </span>
      )}
    </span>
  );
}
