import type { BackgroundSettings, LayoutSettings, LayoutPreset } from "../../../../shared/project";
import { DEFAULT_LAYOUT } from "../../../../shared/project";
import { fillsTheFrame, layoutBoxes, presetFitsFrame, type Size } from "../../../../shared/layout";
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
 * Each arrangement is listed next to its own reflection, so a pair reads as one
 * choice with a side to it rather than as two arrangements that happen to look
 * alike — which holds wherever the row does not break between them. See the
 * note on `GROUPS`.
 *
 * Every thumbnail is drawn by asking `layoutBoxes` where the pictures go and
 * scaling the answer down. Drawing them by hand would be a second
 * implementation of the layout, and it would be wrong the first time a rule
 * changed — silently, in the one place whose whole job is to promise what the
 * export will look like.
 *
 * Drawn on a plate of their own rather than on the composition's background.
 * The background was behind them for a while, so a padded arrangement showed
 * its gap against the thing it would really sit on — but a cell is a diagram,
 * and a photograph behind one turns the grid into fourteen swatches of the
 * same picture with some blocks on top. What the gap has to contrast with is
 * the block beside it, which three fixed tones answer — see `--layout-plate`.
 *
 * The *geometry*, though, is fixed. A cell answers "what is this arrangement",
 * and that question has the same answer whatever the project's padding happens
 * to be set to — so it is drawn at [`THUMB_PADDING`] rather than at the
 * composition's own. Threading the live padding in made the whole grid redraw
 * as the slider moved, which is fourteen pictures changing to describe one
 * setting, and at a low enough value it collapsed arrangements that differ only
 * by their margin into copies of each other. The panel below the grid is where
 * the current value is read; the grid is the menu, not the dish.
 */

/**
 * The arrangements, in the order they appear. Three to a row.
 *
 * Three does not divide the pairs. `beside` and `beside-left` land beside each
 * other, but `over-column` ends a row and `over-column-left` begins the next —
 * so that one pair is read as two choices rather than as one with a side to it.
 * An even number of columns keeps every reflection adjacent; this is the cost
 * of the wider cell.
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
      // Last of the eight, after the arrangements that put a whole camera
      // picture somewhere: this is the one that puts a *person* there, and it
      // is read as a variation on the first cell rather than as another way of
      // dividing the frame.
      {
        value: "over-cutout",
        label: "Full screen, camera cut out of its background at the bottom right",
      },
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
 * The padding every thumbnail is drawn at, whatever the composition's is.
 *
 * Wider than the 0.06 default, and deliberately. A plate is about forty pixels
 * tall, so 0.06 of its shorter edge comes to a pixel and a half: at that size
 * "padded" and "full frame" are the same picture, and two cells that cannot be
 * told apart are a worse failure than a gap drawn wider than it will be.
 *
 * Fixed rather than a floor over the live value. As a floor, turning the
 * padding up redrew all fourteen cells to describe one slider — and the three
 * screen-only cells, which differ from one another *only* by their margin, kept
 * changing what they were promising while the thing being chosen stood still.
 */
const THUMB_PADDING = 0.1;

// Square, so the cell is the same size whatever shape the output frame is and
// the grid does not reflow when someone switches to a vertical preset.
// The same hairline the background swatches carry, for the same reason: a card
// whose own edge is only a slightly lighter fill has no edge at low contrast,
// and these sit on a panel the same family of grey as they are. The chosen one
// still says so with the blue ring, which is drawn inside this.
// No aspect of its own: the cell is as tall as the plate inside it plus the
// same padding on every side. It used to be square, which left a 16:9 plate
// in a box nearly twice its height, with the slack above and below it reading
// as padding that the sides did not have.
// Borderless, matching the filter grid and the slider track — see the note on
// `FILTER_CELL`. The chosen one still says so with the blue ring drawn inside.
const CELL =
  "relative grid place-items-center rounded-lg " +
  "bg-white/5 p-2 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30";

// Three across. Wide enough that a thumbnail can be told apart at a glance,
// without the column of them running off the panel.
const GRID = "grid grid-cols-3 gap-1";

/**
 * How tall a portrait plate is drawn.
 *
 * A landscape plate fills the cell's width and its height follows; a
 * portrait one cannot, or it would be a tall sliver taller than the panel is
 * wide. So it is given a height instead, near what a landscape plate comes
 * to at the panel's width, and its width follows from the frame.
 */
const PORTRAIT_PLATE = "3rem";

export function LayoutPicker({
  frame,
  background,
  value,
  cameraPresent,
  cameraMatte,
  onChange,
}: {
  frame: Size;
  /**
   * The composition's padding, which is all of this the grid uses: a cell is a
   * diagram of an arrangement and is drawn on a plate of its own — see
   * `--layout-plate`.
   */
  background: BackgroundSettings;
  value: LayoutPreset;
  /**
   * Arrangements needing a camera are disabled without one, not hidden. A grid
   * that changes shape depending on the recording is a grid nobody learns, and
   * the empty space would be the only clue that anything was missing.
   */
  cameraPresent: boolean;
  /**
   * Whether the recording has a person matte.
   *
   * One arrangement needs it: with nothing to cut the person out of, the frame
   * fills with the whole camera picture spilling past its box. Greyed rather
   * than hidden, like every other cell that cannot be had on this recording —
   * see the note on `fits`.
   */
  cameraMatte: boolean;
  onChange: (preset: LayoutPreset) => void;
}) {
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
              // The one arrangement that asks something of the recording
              // rather than of the frame.
              const matted = preset.value !== "over-cutout" || cameraMatte;
              const label = !fits
                ? `${preset.label} — needs a frame wider than it is tall`
                : matted
                  ? preset.label
                  : `${preset.label} — this recording was made before backgrounds could be removed`;

              return (
                <button
                  key={preset.value}
                  type="button"
                  aria-label={label}
                  title={label}
                  aria-pressed={preset.value === value}
                  disabled={(group.camera && !cameraPresent) || !fits || !matted}
                  className={cn(CELL, preset.value === value && "ring-2 ring-selected ring-inset")}
                  onClick={() => onChange(preset.value)}
                >
                  <Plate frame={frame} preset={preset.value} background={background} />
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
              className={cn(CELL, "ring-2 ring-selected ring-inset")}
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

/** One thumbnail: the frame, with whichever pictures the arrangement puts in it. */
function Plate({
  frame,
  preset,
  background,
}: {
  frame: Size;
  preset: LayoutPreset;
  /** The composition's padding, for the geometry. Never its paint — see the
      note on `--layout-plate`. */
  background: BackgroundSettings;
}) {
  // A frame of arbitrary size, laid out and then expressed as percentages, so
  // the plate is resolution-independent and needs no measuring.
  const boxes = layoutBoxes(
    frame,
    { ...DEFAULT_LAYOUT, preset } as LayoutSettings,
    // Fixed, and only for the geometry — see `THUMB_PADDING`. The composition
    // is read for its padding and nothing else; what the gap is drawn against
    // is the plate, which is a tone of the picker's own.
    //
    // Zero for an arrangement that fills the frame, because picking one clears
    // the padding: a cell shows what you get the moment you choose it, and a
    // tile called "full frame" drawn with a margin promises something the pick
    // immediately takes away.
    { ...background, padding: fillsTheFrame(preset) ? 0 : THUMB_PADDING },
    THUMB_SOURCES,
  );

  // Drawn as a person with nothing behind them. The arrangement writes
  // `cameraCutout` when it is picked — see `cutoutFor` — so the cell has to
  // promise what the pick will do rather than what the current settings say.
  const cutout = preset === "over-cutout";

  const at = (box: { x: number; y: number; width: number; height: number }) => ({
    left: `${(box.x / frame.width) * 100}%`,
    top: `${(box.y / frame.height) * 100}%`,
    width: `${(box.width / frame.width) * 100}%`,
    height: `${(box.height / frame.height) * 100}%`,
  });

  return (
    <span
      className="relative block overflow-hidden rounded-[6px] bg-layout-plate"
      // The width for a landscape frame and a set height for a portrait one —
      // see `PORTRAIT_PLATE` — so neither overflows the cell nor leaves it
      // mostly empty.
      style={{
        aspectRatio: `${frame.width} / ${frame.height}`,
        width: frame.width >= frame.height ? "100%" : undefined,
        height: frame.width >= frame.height ? undefined : PORTRAIT_PLATE,
      }}
    >
      {boxes.screen && (
        <span
          className="absolute overflow-hidden rounded-[2px] bg-layout-screen"
          style={at(boxes.screen.area)}
        >
          {/* A sketch of something being recorded, rather than a blank block:
              a window's three dots and three lines of content under them.

              Six shapes and no more. This is drawn a few dozen pixels across
              and, in `beside`, as a column narrower than it is tall — past
              about this much detail the parts stop being separable and the
              whole thing reads as noise on the plate. It was a title bar, a
              sidebar and two coloured bands, which at this size was a block
              with a stripe down it; dots and lines are what a window looks
              like when it is drawn small, which is why every app that draws
              one draws these.

              The lights are the only colour. Everything else is one light
              grey in two weights: two hues were there to tell the bands from
              the chrome when both were solid bars, and nothing is a solid bar
              now.

              Proportions rather than pixels, so the sketch squashes with the
              block instead of overflowing it. `overflow-hidden` on the parent
              is what keeps it inside the rounded corner. */}
          <span className="absolute top-[13%] left-[8%] flex items-center gap-[2px]">
            {/* The traffic lights. Three pixels across, where the shape has
                gone and only the colour is left — which is the point: nothing
                else in this app is red, amber and green in a row, so the block
                wearing them is a window before anything else about it is read.

                An exact square in pixels, not a share of the block. They were
                `h-[9%]` with `aspect-square`, which asks the browser to take a
                width from a height that is itself a per cent of a per cent —
                at four-odd pixels that lands between device pixels and the
                dots drew as little ovals. Three pixels is a circle at 1x and
                at 2x, in a block of any size, which is worth more here than
                scaling with it: this is chrome, and chrome does not grow. */}
            <span className="size-[3px] shrink-0 rounded-full bg-layout-light-close" />
            <span className="size-[3px] shrink-0 rounded-full bg-layout-light-min" />
            <span className="size-[3px] shrink-0 rounded-full bg-layout-light-max" />
          </span>
          <span className="absolute top-[34%] left-[8%] h-[9%] w-[62%] rounded-full bg-layout-ui" />
          <span className="absolute top-[51%] left-[8%] h-[9%] w-[44%] rounded-full bg-layout-ui/70" />
          <span className="absolute top-[68%] left-[8%] h-[9%] w-[54%] rounded-full bg-layout-ui/70" />
        </span>
      )}
      {boxes.camera && (
        <span
          className={cn(
            "absolute grid place-items-center overflow-hidden",
            // No block behind a cut-out person: the matte is their outline,
            // and a card under them is the one thing this arrangement is not.
            //
            // White, where the one standing on a block is `--layout-person`.
            // That one is a mark on a mid grey with the block beside it saying
            // "camera"; this one is alone on the screen, and it is the whole
            // difference between this cell and the full-screen one two rows
            // above — so it is the brightest thing in the grid rather than a
            // tone of it.
            cutout ? "text-white" : "bg-layout-camera text-layout-person",
            // The bubble reads as a bubble at this size only if it is round.
            cutout ? "" : boxes.camera.card ? "rounded-[2px]" : "rounded-full",
            // Both edges, so the glyph stays square and centres itself inside
            // whatever shape the block is — a tall column in `beside`, a wide
            // band in `stacked`. `meet` is the SVG default and does the rest.
            //
            // The cut-out person fills their box instead and is pushed to its
            // floor: they are drawn uncropped in the frame, standing on the
            // bottom edge rather than floating in the middle of a bubble.
            cutout ? "items-end [&>svg]:h-full [&>svg]:w-full" : "[&>svg]:h-[75%] [&>svg]:w-[75%]",
          )}
          style={at(boxes.camera.area)}
        >
          {/* Says which block is the camera, and with both blocks grey it is
              the only thing that does. Light on the mid grey, which is the way
              round that survives being nine pixels across — see
              `--layout-person`. */}
          <PersonIcon />
        </span>
      )}
    </span>
  );
}
