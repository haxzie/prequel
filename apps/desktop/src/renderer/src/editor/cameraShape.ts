/**
 * What the camera's shape list offers, and what picking one of them writes.
 *
 * Apart from the panel because two things need the second half and they must
 * not disagree: clicking a row commits it, and hovering a row shows it on the
 * picture first. Written twice, the preview would be of something other than
 * what the click does — which is worse than no preview, because it is a
 * promise the editor then breaks.
 *
 * Free of React, like `boxes.ts` beside it: this is a table and a function from
 * one choice to a handful of leaves.
 */
import {
  CAMERA_FRAMES,
  CAMERA_FRAME_IDS,
  cameraFrame,
  type CameraFrameId,
} from "../../../shared/camera-frames";
import { shapeAspect, type Size } from "../../../shared/layout";
import { SHAPE_RADIUS, type CameraShape, type LayoutSettings } from "../../../shared/project";

/**
 * One answer to "what outline does the camera have".
 *
 * Three kinds in one list, because it is one question. The cutout and the
 * frames are stored in leaves of their own — see `cameraFrame` in
 * `project.ts` — and this is the only place that knows the three are
 * alternatives.
 */
export type CameraShapeChoice = CameraShape | "cutout" | Exclude<CameraFrameId, "none">;

export interface CameraShapeOption {
  value: CameraShapeChoice;
  label: string;
  /**
   * A line under the label, in the list.
   *
   * What it looks like, not what it does to the numbers — the same voice the
   * colour looks' notes are written in. The room, not the kelvin.
   */
  note: string;
}

/**
 * Every shape, in the order the list offers them.
 *
 * Plain shapes first because they are what most cameras are, then the two that
 * replace the edge with the person, then the frames. A flat list rather than
 * three with headings: twelve rows is short enough to read, and a heading over
 * two of them is more furniture than it saves.
 */
export const CAMERA_SHAPES: CameraShapeOption[] = [
  { value: "circle", label: "Circle", note: "A plain round bubble." },
  { value: "squircle", label: "Squircle", note: "Round at the corners, the way macOS is." },
  { value: "rounded", label: "Rounded", note: "A square with the corners taken off." },
  { value: "wide", label: "Wide", note: "The camera's own picture, uncropped." },
  { value: "portrait", label: "Portrait", note: "The same crop stood on end." },
  {
    value: "cutout",
    label: "No background",
    note: "The room behind you is taken away.",
  },
  {
    value: "blob",
    label: "Follow me",
    note: "The shape follows you, and opens around a raised hand.",
  },
  ...CAMERA_FRAME_IDS.map((id) => ({
    value: id,
    label: CAMERA_FRAMES[id].label,
    note: CAMERA_FRAMES[id].hint,
  })),
];

/**
 * The leaves picking one of those rows writes.
 *
 * The three answers are stored in three leaves and each of them *stays* where
 * it was under the other two: the shape under a frame, the shape and the frame
 * under a cutout. That is what lets taking a frame off put back the shape and
 * the roundness that were chosen before it went on — so what this returns is
 * only ever the leaves that actually have to move.
 *
 * `cameraCutout: false` and `cameraFrame: "none"` are written *only* where
 * there is one to let go of. Written every time, a `false` would land in a
 * clip's overrides on any shape change and mark the cutout as set for that
 * clip when nobody set it.
 */
export function cameraShapePatch(
  choice: CameraShapeChoice,
  layout: LayoutSettings,
  /** The camera's own picture, for the shapes whose width follows it. */
  source: Size | null,
): Partial<LayoutSettings> {
  // The size, zoom and framing are left as they are: the cutout is the same
  // picture with its background gone, not a new one.
  if (choice === "cutout") return { cameraCutout: true };

  const letGo: Partial<LayoutSettings> = layout.cameraCutout ? { cameraCutout: false } : {};

  const dressing = cameraFrame(choice);
  if (dressing) {
    return {
      ...letGo,
      cameraFrame: choice as CameraFrameId,
      // The hole's own proportions, so a frame opens drawn at the shape it was
      // made at rather than stretched into whatever the last shape left
      // behind. The corner radius is deliberately *not* touched: the hole in
      // the art is the shape while the frame is on.
      cameraWidth: layout.cameraHeight * dressing.aspect,
    };
  }

  const shape = choice as CameraShape;
  return {
    ...letGo,
    ...(layout.cameraFrame === "none" ? {} : { cameraFrame: "none" as const }),
    cameraShape: shape,
    // The shape decides the proportions and the roundness once, here, rather
    // than on every frame. Derived during layout instead, a bubble someone had
    // dragged to a shape of their own would snap back to a square the next time
    // this control was touched — and the same was true of a radius someone had
    // dialled in by hand.
    cameraWidth: layout.cameraHeight * shapeAspect(shape, source),
    cameraCornerRadius: SHAPE_RADIUS[shape],
  };
}

/** Which row is lit, for a camera wearing these settings. */
export function cameraShapeChoice(layout: LayoutSettings): CameraShapeChoice {
  if (layout.cameraCutout) return "cutout";
  if (layout.cameraFrame !== "none") return layout.cameraFrame;
  return layout.cameraShape;
}
