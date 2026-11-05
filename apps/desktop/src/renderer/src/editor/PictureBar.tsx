import type { ReactNode } from "react";

import type { PlanSource, Rect, Size } from "../../../shared/layout";
import { cn } from "../lib/cn";
import { PillNumber } from "./controls/PillNumber";
import { CameraIcon, CheckIcon, CloseIcon, CropIcon, ResetIcon, ScreenIcon } from "./icons";
import { FLOATING } from "./surfaces";

/**
 * The bar the frame picker becomes while a picture is ringed.
 *
 * The same pill in the same place, because it is the same question asked of a
 * narrower subject: with nothing selected the thing being sized is the output,
 * and with the recording selected it is the recording. Two bars stacked over
 * the composition would have put the frame's numbers next to the picture's,
 * which are four readings in the same units that mean different things.
 *
 * Position and size are typed here rather than only dragged. A drag is how a
 * composition is arrived at and a number is how it is matched — "the same inset
 * as the last one" is not a gesture — and both go through `boxPatch`, so the
 * two cannot disagree about which arrangement a resize falls out of.
 */
export function PictureBar({
  target,
  box,
  onBox,
  canCrop,
  onCrop,
  onDone,
  onCancel,
}: {
  target: PlanSource;
  /** Where the picture rests, in output pixels. */
  box: Rect;
  /** The same box, moved or resized. Whole pixels, as typed. */
  onBox: (box: Rect, resize: boolean) => void;
  /** False until the source has opened: there is nothing to crop a frame of. */
  canCrop: boolean;
  onCrop: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  return (
    <Bar>
      <Title target={target} />

      <Group label="Position">
        <PillNumber
          label="Centre across"
          value={centre.x}
          onChange={(x) => onBox({ ...box, x: x - box.width / 2 }, false)}
        />
        <PillNumber
          label="Centre down"
          value={centre.y}
          onChange={(y) => onBox({ ...box, y: y - box.height / 2 }, false)}
        />
      </Group>

      <Divider />

      <Group label="Size">
        <PillNumber
          label="Width"
          value={box.width}
          normalise={atLeastOne}
          // Grown about the middle, like a drag of a corner with the opposite
          // one held — a typed width that moved the left edge would walk the
          // picture across the frame as it was being sized, and the position
          // fields are right there for moving it.
          onChange={(width) => onBox({ ...box, x: centre.x - width / 2, width }, true)}
        />
        <span className="text-editor-fg">×</span>
        <PillNumber
          label="Height"
          value={box.height}
          normalise={atLeastOne}
          onChange={(height) => onBox({ ...box, y: centre.y - height / 2, height }, true)}
        />
      </Group>

      <Divider />

      <PillButton
        label="Crop"
        title="Choose the part of the footage that stays"
        disabled={!canCrop}
        onClick={onCrop}
      >
        <CropIcon />
      </PillButton>

      <Divider />

      {/* Cancel first and Done last, so the one that commits is the one
          furthest from the numbers that were being typed — and the one under
          the hand on the way out of the bar. */}
      <PillButton label="Cancel" title="Put it back as it was" onClick={onCancel}>
        <CloseIcon />
      </PillButton>
      <PillButton label="Done" title="Keep it" primary onClick={onDone}>
        <CheckIcon />
      </PillButton>
    </Bar>
  );
}

/**
 * The bar while the crop surface has the board.
 *
 * Its own component rather than a mode of the one above, because the numbers
 * mean something else: these are source pixels of the take, where a picture
 * bar's are output pixels of the frame. One bar whose four fields changed units
 * depending on a flag is how a reading comes to be read in the wrong one.
 */
export function CropBar({
  target,
  crop,
  size,
  onCropChange,
  onReset,
  onDone,
  onCancel,
}: {
  target: PlanSource;
  /** The region that stays, in source pixels. */
  crop: Rect;
  /** The take's own dimensions. */
  size: Size;
  onCropChange: (crop: Rect) => void;
  onReset: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const whole =
    crop.x === 0 && crop.y === 0 && crop.width === size.width && crop.height === size.height;

  return (
    <Bar>
      <Title target={target} verb="Crop" />

      <Group label="Offset">
        <PillNumber
          label="From the left"
          value={crop.x}
          onChange={(x) => onCropChange({ ...crop, x })}
        />
        <PillNumber
          label="From the top"
          value={crop.y}
          onChange={(y) => onCropChange({ ...crop, y })}
        />
      </Group>

      <Group label="Size">
        <PillNumber
          label="Crop width"
          value={crop.width}
          normalise={atLeastOne}
          onChange={(width) => onCropChange({ ...crop, width })}
        />
        <span className="text-editor-fg">×</span>
        <PillNumber
          label="Crop height"
          value={crop.height}
          normalise={atLeastOne}
          onChange={(height) => onCropChange({ ...crop, height })}
        />
      </Group>

      <Divider />

      <PillButton
        label="Whole frame"
        title="Take the crop off again"
        disabled={whole}
        onClick={onReset}
      >
        <ResetIcon />
      </PillButton>

      <Divider />

      <PillButton label="Cancel" title="Leave the footage as it was" onClick={onCancel}>
        <CloseIcon />
      </PillButton>
      <PillButton label="Done" title="Crop to this" primary onClick={onDone}>
        <CheckIcon />
      </PillButton>
    </Bar>
  );
}

/**
 * The pill both bars are made of.
 *
 * `FrameBar`'s own, deliberately to the pixel: these three swap places over the
 * same picture, and a bar that changed height or radius as the selection
 * changed would read as a different object arriving rather than as the same one
 * showing something else. `FRAME_BAR` in `surfaces.ts` is the number the stage
 * holds clear for all of them.
 */
function Bar({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "relative flex flex-none items-center justify-center gap-2 rounded-full px-3 py-1.5",
        FLOATING,
      )}
      data-panel="picture-bar"
    >
      {children}
    </div>
  );
}

/** Which picture this bar is about, in a word and a glyph. */
function Title({ target, verb }: { target: PlanSource; verb?: string }) {
  return (
    <span className="flex items-center gap-1.5 pr-1 pl-1 text-[11px] tracking-wide text-editor-fg uppercase [&_svg]:size-3.5">
      {target === "camera" ? <CameraIcon /> : <ScreenIcon />}
      {verb ?? (target === "camera" ? "Camera" : "Recording")}
    </span>
  );
}

/**
 * A pair of numbers under one accessible name.
 *
 * The name is on the group rather than repeated into both fields, which is what
 * keeps the bar readable: four labelled boxes across a pill is more words than
 * picture.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-xs" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="h-4 w-px flex-none bg-editor-line" />;
}

/**
 * A glyph with a name only a screen reader sees.
 *
 * Text on these would make the bar half again as wide, and it sits over the
 * composition — which is the thing being looked at. `title` is what a pointer
 * gets; the two say the same thing in the same words.
 */
function PillButton({
  label,
  title,
  primary,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "grid size-7 flex-none place-items-center rounded-full [&_svg]:size-3.5",
        primary ? "bg-export text-white hover:brightness-110" : "text-editor-fg hover:bg-white/10",
        disabled && "pointer-events-none opacity-40",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A box or a crop is at least a pixel: nothing is not a size. */
const atLeastOne = (value: number) => Math.max(1, Math.round(value));
