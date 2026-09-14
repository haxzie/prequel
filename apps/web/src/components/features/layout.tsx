import { CLIP_H, Clip, ClipLabel, Filmstrip, Strip } from "@/components/editor-controls";
import { Bubble, Chip, Frame, Pointer, Screen, Slab } from "@/components/features/frame";
import { type Layout, LayoutGlyph } from "@/components/landing/glyphs";
import { CAMERA_CUTOUT, CAPTIONS_SCREEN, LAYOUT_SCREEN } from "@/components/landing/stage";

/**
 * The pictures on the Layout and camera cards.
 */

/**
 * The fourteen arrangements, in the picker's three groups.
 *
 * The boxes are in the frame's own 16-by-9 units, the same space `LayoutDemo`
 * writes its six in, so the thumbnail of "Beside" here is the thumbnail of
 * "Beside" there. The order and the grouping are `LayoutPicker.tsx`'s: the two
 * pictures together, then the camera alone, then the screen alone.
 */
const BOTH: Layout[] = [
  {
    name: "Full screen, camera over",
    screen: [0, 0, 16, 9],
    camera: [12.4, 5.4, 3.06, 3.06],
    bubble: true,
  },
  {
    name: "Padded screen, camera over",
    screen: [1.6, 1, 12.8, 7],
    camera: [11.1, 4.8, 2.88, 2.88],
    bubble: true,
  },
  {
    name: "Camera standing over the right end",
    screen: [1.6, 1, 12.8, 7],
    camera: [10.9, 1.7, 3.1, 5.6],
  },
  {
    name: "Camera standing over the left end",
    screen: [1.6, 1, 12.8, 7],
    camera: [2, 1.7, 3.1, 5.6],
  },
  {
    name: "Side by side, camera right",
    screen: [0.5, 1.9, 9.2, 5.2],
    camera: [10.3, 1.9, 5.2, 5.2],
  },
  { name: "Side by side, camera left", screen: [6.3, 1.9, 9.2, 5.2], camera: [0.5, 1.9, 5.2, 5.2] },
  {
    name: "Screen above the camera",
    screen: [3.66, 0.54, 8.68, 4.88],
    camera: [6.75, 5.96, 2.5, 2.5],
  },
  { name: "Split down the middle", screen: [0, 0, 8, 9], camera: [8, 0, 8, 9] },
];

const CAMERA_ONLY: Layout[] = [
  { name: "Camera, full frame", camera: [0, 0, 16, 9] },
  { name: "Camera, padded", camera: [1.6, 1, 12.8, 7] },
  { name: "Camera, further back", camera: [3.2, 1.8, 9.6, 5.4] },
];

/**
 * The screen-only three have no camera, and `Layout` insists on one. A zero
 * box is a camera that draws nothing, which is what the picker shows too.
 */
const SCREEN_ONLY: Layout[] = [
  { name: "Screen, full frame", screen: [0, 0, 16, 9], camera: [0, 0, 0, 0] },
  { name: "Screen, padded", screen: [1.6, 1, 12.8, 7], camera: [0, 0, 0, 0] },
  { name: "Screen, further back", screen: [3.2, 1.8, 9.6, 5.4], camera: [0, 0, 0, 0] },
];

function PickerGroup({
  label,
  layouts,
  selected,
}: {
  label: string;
  layouts: Layout[];
  selected?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] text-editor-muted">{label}</span>
      {/* Wraps, because a single cell at `sm` is about 300px and eight cells
          of 44px are not. The eighth drops to a second line rather than
          running under the frame's edge. */}
      <div className="flex flex-wrap gap-1">
        {layouts.map((layout, i) => (
          <span
            key={layout.name}
            className={`grid place-items-center rounded-md px-1 py-1 text-editor-fg [&_svg]:h-5 [&_svg]:w-9 ${
              i === selected ? "bg-selected/25 ring-1 ring-selected" : "bg-white/5"
            }`}
          >
            <LayoutGlyph layout={layout} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function LayoutPicker() {
  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-5 -bottom-6" inner="flex flex-col gap-3 px-4 pt-3">
        <PickerGroup label="Screen and camera" layouts={BOTH} selected={1} />
        <div className="flex gap-5">
          <PickerGroup label="Camera only" layouts={CAMERA_ONLY} />
          <PickerGroup label="Screen only" layouts={SCREEN_ONLY} />
        </div>
      </Slab>
    </Frame>
  );
}

/**
 * The five shapes, each with the same face in it.
 *
 * The corner treatments are `SHAPE_RADIUS`: a half for the circle and the
 * squircle, 0.18 for rounded, 0.12 for wide and portrait. Wide and portrait
 * are the two that keep the camera's own proportions, so those two boxes are
 * not square.
 */
const SHAPES = [
  { name: "Circle", shape: "rounded-full", size: "size-12" },
  { name: "Squircle", shape: "squircle rounded-full", size: "size-12" },
  { name: "Rounded", shape: "rounded-[0.55rem]", size: "size-12" },
  { name: "Wide", shape: "rounded-[0.5rem]", size: "h-12 w-[4.25rem]" },
  { name: "Portrait", shape: "rounded-[0.4rem]", size: "h-12 w-9" },
];

export function CameraShapes() {
  return (
    <Frame stage="facet">
      <div className="absolute inset-0 flex items-center justify-center gap-2.5 px-3">
        {SHAPES.map((shape) => (
          <span key={shape.name} className="flex flex-col items-center gap-2">
            <span className={`relative ${shape.size}`}>
              <Bubble className="inset-0" shape={shape.shape} />
            </span>
            <span className="font-mono text-[9px] text-white/85">{shape.name}</span>
          </span>
        ))}
      </div>
    </Frame>
  );
}

/**
 * The bubble, out of the way while a zoom is in.
 *
 * The dashed outline is the size it is the rest of the time; the solid bubble
 * inside it is `Size while zoomed`. The recording behind is pushed in, because
 * the shrink only ever happens during a push and a bubble shrinking on a still
 * frame is a bubble that got smaller for no reason.
 */
export function ShrinkOnZoom() {
  return (
    <Frame stage="peony">
      <div
        className="absolute -right-8 -bottom-8 top-6 left-6 overflow-hidden rounded-lg bg-no-repeat shadow-[0_18px_40px_-18px_rgb(0_0_0_/_0.55)] ring-1 ring-black/10"
        style={{
          backgroundImage: `url(${LAYOUT_SCREEN})`,
          backgroundSize: "170%",
          backgroundPosition: "40% 30%",
        }}
      />
      <span className="squircle absolute right-6 bottom-5 size-[4.5rem] rounded-full border-2 border-dashed border-white/80" />
      <Bubble className="right-6 bottom-5 size-10" />
      <Chip className="top-9 left-9">Size while zoomed 55%</Chip>
    </Frame>
  );
}

/**
 * Two clips, each wearing its own arrangement.
 *
 * The glyph in a clip's label is the app's own: a slice with a layout override
 * carries the arrangement's thumbnail where a plain one carries the track
 * icons. Two different glyphs on one row is the claim.
 */
export function LayoutPerClip() {
  const padded = BOTH[1]!;
  const beside = BOTH[4]!;

  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-9 -bottom-6">
        <Strip>
          <div className="pt-4">
            <div className="flex gap-1.5" style={{ height: CLIP_H }}>
              <Clip width={0.55}>
                <Filmstrip src={LAYOUT_SCREEN} cells={6} />
                <ClipLabel icons={<LayoutGlyph layout={padded} />} read="0:12" />
              </Clip>
              <Clip width={0.45} selected>
                <Filmstrip src={CAPTIONS_SCREEN} cells={5} />
                <ClipLabel icons={<LayoutGlyph layout={beside} />} read="0:18" />
              </Clip>
            </div>
          </div>
        </Strip>
      </Slab>
      <Chip className="top-3 left-4">One layout per clip</Chip>
    </Frame>
  );
}

/**
 * The bubble, dragged out of its corner.
 *
 * A dashed ghost where it started, the solid bubble where it has been taken,
 * and the pointer still on it. The path between them is drawn so the two read
 * as one bubble before and after rather than as two cameras.
 */
export function DragAnywhere() {
  return (
    <Frame stage="facet">
      <Screen className="-right-8 -bottom-8 top-6 left-6" />
      <span className="squircle absolute right-10 bottom-6 size-14 rounded-full border-2 border-dashed border-white" />
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M84 74 C 70 40, 50 30, 30 42"
          fill="none"
          stroke="rgb(255 255 255 / 0.8)"
          strokeWidth="0.8"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Bubble className="top-9 left-[18%] size-14" />
      <Pointer className="top-[52%] left-[28%] w-7" />
    </Frame>
  );
}

/**
 * The camera with its background gone: the person, standing on the wallpaper.
 *
 * A wide card at the row's height rather than a tall one. A tall frame put the
 * figure under the recording and the two read as a portrait with a screen for
 * a hat; side by side, the recording runs off the top and right the way it does
 * in the capture step and the person stands in front of its corner, which is
 * where a bubble would have been. Nothing a bubble has is drawn: no shape, no
 * border, no shadow. The app draws a cutout exactly that way — there is no
 * edge left to dress — so nothing is added here to lift it off the ground
 * either.
 *
 * The figure is taller than the frame and cut off by its bottom edge, so it
 * reads as standing in the picture rather than pasted inside it. The picture is
 * the product's own matte on the same face as every other camera on the page;
 * `stage.ts` says how it was made.
 */
export function Cutout() {
  return (
    <Frame stage="facet">
      <Screen className="-top-8 -right-10 bottom-7 left-6" />
      <img
        src={CAMERA_CUTOUT}
        alt=""
        width={300}
        height={400}
        draggable={false}
        className="pointer-events-none absolute right-[8%] -bottom-1 h-[118%] w-auto max-w-none select-none"
      />
      <Chip className="bottom-3 left-3">Background removed</Chip>
    </Frame>
  );
}
