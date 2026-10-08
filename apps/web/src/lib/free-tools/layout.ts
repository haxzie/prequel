/**
 * Where everything sits in a frame the browser is about to encode.
 *
 * One module, and every consumer reads the plan it emits: the preview canvas
 * draws it and the canvas the recorder captures from draws the same one. That
 * is the desktop app's rule for `shared/layout.ts` applied to the free tools,
 * and it is here for the same reason — two implementations of "where does the
 * camera sit" is how a preview and a file come to disagree, and the only person
 * who notices is the one who already downloaded the recording.
 *
 * Deliberately not an import from `apps/desktop`. The two apps share no code,
 * so this is a second, smaller plan builder for a second, smaller product: the
 * browser tools place a recording and one camera bubble in a frame, and none of
 * the slices, zooms, backgrounds or per-slice looks the editor's plan carries.
 *
 * Nothing here touches a canvas or a DOM node, which is what lets the whole of
 * the layout be reasoned about without a browser.
 */

/** Which corner the camera bubble is pinned to. */
export type CameraCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** The bubble's outline. `wide` is the only one that is not square. */
export type CameraShape = "circle" | "squircle" | "rounded" | "wide";

/** An output frame, in pixels. */
export type Frame = { width: number; height: number };

/**
 * The look, as the controls set it.
 *
 * Every geometry figure is a **fraction of the frame's shorter edge**, never a
 * pixel count. That is what lets one set of values survive a change of frame:
 * switch a take from 16:9 to 9:16 and the bubble stays proportionally where it
 * was, where a pixel figure would put it off the edge.
 *
 * There was a background, padding, a corner radius and a shadow here, with four
 * controls in the rail for them. They are gone: this is a recorder, and a look
 * is what the editor on a Mac is for. What the browser puts in the file now is
 * the recording, at the frame asked for, with the camera where it was put.
 */
export type Look = {
  camera: {
    on: boolean;
    /** The bubble's shorter edge, 0.1 to 0.4. */
    size: number;
    corner: CameraCorner;
    shape: CameraShape;
    /** Drawn as a mirror, which is how people expect to see themselves. */
    mirrored: boolean;
  };
};

/** A box in output pixels, with the radius it is clipped to. */
export type Rect = { x: number; y: number; width: number; height: number; radius: number };

/**
 * How the source meets the padded area it is drawn into.
 *
 * `contain` keeps every pixel of a screen recording, because the edge of a
 * window is usually where the thing being shown is. `cover` crops to the middle
 * and is what a camera wants: a 16:9 webcam letterboxed into a 9:16 video is a
 * face floating in a band, and the frame was chosen to be filled.
 */
export type Fit = "contain" | "cover";

export type RenderPlan = {
  frame: Frame;
  /** The recording itself, which is now the whole frame. */
  screen: Rect | null;
  /** Passed through to the compositor, which does the cropping. */
  fit: Fit;
  camera: (Rect & { shape: CameraShape; mirrored: boolean }) | null;
};

/**
 * How far the bubble stands off the frame edge.
 *
 * A fraction of the shorter edge, as everything else here is. It is a constant
 * rather than a control because the one thing a reader never wants to tune is
 * the distance between two things they did not place.
 */
const CAMERA_INSET = 0.028;

/** The aspect a `wide` bubble is drawn at. The other three are square. */
const WIDE_ASPECT = 16 / 9;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The radius a shape asks for, as a fraction of the bubble's shorter edge.
 *
 * `circle` is 0.5 and is therefore exactly a circle at any size, which is why
 * the compositor needs no special case for it. `squircle` is the app's own
 * superellipse approximated by a radius, because a 2D canvas has no
 * `corner-shape` and the difference at bubble size is a pixel.
 */
function shapeRadius(shape: CameraShape): number {
  switch (shape) {
    case "circle":
      return 0.5;
    case "squircle":
      return 0.32;
    case "rounded":
      return 0.14;
    case "wide":
      return 0.09;
  }
}

/**
 * Fit a source into a box, keeping its proportions and centring it.
 *
 * Under `cover` the box is returned whole and the compositor crops the picture
 * into it. Under `contain` the box shrinks to the source's proportions, which is
 * what leaves the bars at the sides of a landscape recording in a vertical
 * frame.
 */
function fitInto(source: Frame, box: Rect, fit: Fit): Rect {
  if (fit === "cover") return box;

  const scale = Math.min(box.width / source.width, box.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;

  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
    radius: box.radius,
  };
}

/**
 * The frame, resolved into absolute output pixels.
 *
 * `source` is null until a stream arrives, and the plan then has no screen rect
 * rather than a guessed one: a placeholder sized to the frame would be drawn at
 * the wrong aspect for the first few frames of every preview.
 */
export function buildRenderPlan({
  frame,
  source,
  look,
  fit = "contain",
}: {
  frame: Frame;
  source: Frame | null;
  look: Look;
  fit?: Fit;
}): RenderPlan {
  // The whole frame, squared off. With the look controls gone there is nothing
  // to inset the recording by and nothing to round it with, so the area the
  // picture is fitted into is the output itself.
  const area: Rect = { x: 0, y: 0, width: frame.width, height: frame.height, radius: 0 };
  const screen = source ? fitInto(source, area, fit) : null;

  return {
    frame,
    screen,
    fit,
    camera: look.camera.on ? cameraRect(frame, look) : null,
  };
}

function cameraRect(frame: Frame, look: Look) {
  const shorter = Math.min(frame.width, frame.height);
  const shape = look.camera.shape;
  const size = clamp(look.camera.size, 0.1, 0.4) * shorter;

  const width = shape === "wide" ? size * WIDE_ASPECT : size;
  const height = size;

  const inset = CAMERA_INSET * shorter;
  const right = look.camera.corner.endsWith("right");
  const bottom = look.camera.corner.startsWith("bottom");

  return {
    // Clamped, because this is the invariant worth holding: whatever the
    // controls are set to, no part of the plan leaves the frame. A frame small
    // enough that a 40% bubble plus its inset would overhang is reachable with
    // the vertical preset and one drag of the size slider.
    x: clamp(right ? frame.width - inset - width : inset, 0, Math.max(0, frame.width - width)),
    y: clamp(bottom ? frame.height - inset - height : inset, 0, Math.max(0, frame.height - height)),
    width,
    height,
    radius: shapeRadius(shape) * Math.min(width, height),
    shape,
    mirrored: look.camera.mirrored,
  };
}
