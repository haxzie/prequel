/**
 * What a gesture on a picture writes back into the settings.
 *
 * Its own module because three things now ask the same question and the answer
 * has to be one piece of arithmetic: dragging a corner in the preview, typing a
 * number into the picture bar, and finishing a crop. Written twice, the three
 * disagree about which arrangement a resize falls out of — and the one that
 * loses is whichever was touched last.
 *
 * Free of React, and of the plan: it takes boxes in output pixels and hands
 * back leaves. `shared/layout.ts` is still the only thing that decides where a
 * box *is* — see the note there on geometry being computed once.
 */
import type { LayoutSettings, WatermarkSettings } from "../../../shared/project";
import type { PlanSource, Rect, Size } from "../../../shared/layout";
import { fitInside } from "./fit";

/**
 * What a drag in the preview can take hold of.
 *
 * `PlanSource` and the logo. Deliberately wider than `PlanSource`, which names
 * the two *video* textures — a watermark is a still file, and the only thing it
 * shares with them is that it has a box somebody can move.
 */
export type Grabbable = PlanSource | "watermark";

/**
 * Where both pictures are right now, for the seeding below.
 *
 * Boxes in output pixels, as the plan has them — not the settings' own, which
 * are what is being written. `card` comes along because `custom` has to be told
 * which dressing the camera arrived in; see `seededBoxes`.
 */
export interface RestingBoxes {
  screen: Rect | null;
  camera: (Rect & { card: boolean }) | null;
}

/**
 * The arrangement to fall into when the bubble is picked up, or null.
 *
 * The `over-*` arrangements already leave the camera free, so dragging inside
 * one changes nothing structural. Every other arrangement placed the bubble,
 * and moving it is a request to stop.
 */
export function detachedPreset(preset: LayoutSettings["preset"]): LayoutSettings["preset"] | null {
  switch (preset) {
    case "over-full":
    case "over-padded":
    case "custom":
      return null;
    // Dragged out of its corner, the person keeps the screen they were
    // standing on: `over-full` is this arrangement with the box handed back to
    // the camera's own four numbers. `over-padded` would put a margin round a
    // picture that was full-bleed a moment ago, which is not what moving
    // somebody asked for.
    case "over-cutout":
      return "over-full";
    case "split":
    case "camera-full":
    default:
      return "over-padded";
  }
}

/**
 * Both boxes exactly where they are now, as `custom` would store them.
 *
 * Written whenever a gesture falls out of an arrangement, so the picture that
 * is *not* being touched stays where it was. Without it, resizing the screen
 * out of a split sent the camera back to the default bubble in the corner — a
 * jump nobody asked for, on the one gesture where the eye is on the other
 * picture waiting to see what happens to it.
 */
export function seededBoxes(frame: Size, rest: RestingBoxes): Partial<LayoutSettings> {
  const unit = Math.min(frame.width, frame.height);
  const patch: Partial<LayoutSettings> = {};

  if (rest.screen) {
    patch.screenX = (rest.screen.x + rest.screen.width / 2) / frame.width;
    patch.screenY = (rest.screen.y + rest.screen.height / 2) / frame.height;
    patch.screenWidth = rest.screen.width / unit;
    patch.screenHeight = rest.screen.height / unit;
  }

  if (rest.camera) {
    patch.cameraX = (rest.camera.x + rest.camera.width / 2) / frame.width;
    patch.cameraY = (rest.camera.y + rest.camera.height / 2) / frame.height;
    patch.cameraWidth = rest.camera.width / unit;
    patch.cameraHeight = rest.camera.height / unit;
    // Which dressing it had, so `custom` can keep it. Without this, dragging
    // the screen out of a split turned the camera beside it from a
    // square-cornered card into a round bubble — a change to the picture the
    // user was not touching.
    patch.cameraCard = rest.camera.card;
  }

  return patch;
}

/**
 * The leaves that put `target` in `box`.
 *
 * `resize` is whether the box's *size* is part of the statement. A move writes
 * a position and nothing else, which is what keeps dragging a bubble inside a
 * split from freezing the screen beside it — see the camera branch.
 */
export function boxPatch(
  target: Grabbable,
  resize: boolean,
  box: Rect,
  frame: Size,
  layout: LayoutSettings,
  rest: RestingBoxes,
): { section: "layout" | "watermark"; patch: Record<string, unknown> } {
  const unit = Math.min(frame.width, frame.height);
  const centre = {
    x: (box.x + box.width / 2) / frame.width,
    y: (box.y + box.height / 2) / frame.height,
  };

  if (target === "watermark") {
    // Nothing to seed and no arrangement to fall out of: the logo is placed
    // by its own four numbers in every composition, so a drag writes them and
    // there is nothing else to keep in step.
    const patch: Partial<WatermarkSettings> = {
      watermarkX: centre.x,
      watermarkY: centre.y,
    };

    if (resize) {
      patch.watermarkWidth = box.width / unit;
      patch.watermarkHeight = box.height / unit;
    }

    return { section: "watermark", patch };
  }

  if (target === "camera") {
    // The `over-*` arrangements and `custom` already leave the camera's box
    // to its own settings, so neither moving nor resizing it there is a
    // change of arrangement at all: write the box and leave the preset be.
    // Forcing `custom` on any resize also froze the *screen* box, which is
    // how pulling a corner of the bubble quietly disconnected the padding
    // slider from the picture beside it.
    //
    // Anywhere else the arrangement placed the camera. Moving it is a request
    // for the arrangement that does not — keeping whatever full-bleed or
    // padded look the screen already had, because that is not what was being
    // changed. Resizing it has no `over-*` answer, the camera being given a
    // shape of its own, which is what `custom` is for.
    const placed = detachedPreset(layout.preset) !== null;
    const loose = !placed ? null : resize ? "custom" : detachedPreset(layout.preset);
    const detaching = loose !== null && loose !== layout.preset;

    const patch: Partial<LayoutSettings> = {
      ...(detaching ? seededBoxes(frame, rest) : {}),
      cameraX: centre.x,
      cameraY: centre.y,
    };

    if (resize) {
      patch.cameraWidth = box.width / unit;
      patch.cameraHeight = box.height / unit;
    }
    if (detaching) {
      patch.preset = loose!;
      // `camera-*` ignores the toggle, so the camera may have been on screen
      // with it switched off. The arrangement it lands in respects it.
      patch.cameraVisible = true;
    }

    return { section: "layout", patch };
  }

  // The screen has no free-standing arrangement to fall back on: every
  // arrangement that placed it owns its box, so moving or resizing it is
  // `custom` by definition.
  return {
    section: "layout",
    patch: {
      ...(layout.preset === "custom" ? {} : seededBoxes(frame, rest)),
      preset: "custom",
      screenX: centre.x,
      screenY: centre.y,
      screenWidth: box.width / unit,
      screenHeight: box.height / unit,
    },
  };
}

/**
 * The leaves that make `crop` the part of `source` the picture shows.
 *
 * Two halves of one statement, which is why they are written together. The box
 * takes the crop's proportions — a square region of a 16:9 take is a square
 * picture, not a square squashed into a wide slot — and the crop leaf and the
 * two offsets choose the window inside the source. `place` works the window out
 * from the box and the crop level, so writing one without the other is a
 * picture of the wrong region drawn in the wrong shape.
 *
 * The arithmetic is `place`'s own, read backwards. Under `cover` it scales the
 * source by `max(area.width / source.width, area.height / source.height) *
 * crop` and takes `area / scale` of it, so the level that yields a window
 * exactly `crop.width` across is the ratio of the two. The offsets are
 * fractions of the source away from its middle, which is where `place` starts
 * the window.
 *
 * `drawn` is the box the picture rests in now. The cropped box is the largest
 * one of the crop's shape that fits inside it, on the same centre: a crop is a
 * statement about what is in shot, and one that made the picture bigger than it
 * was would be two statements.
 */
export function cropPatch(
  target: PlanSource,
  crop: Rect,
  source: Size,
  drawn: Rect,
  frame: Size,
  layout: LayoutSettings,
  rest: RestingBoxes,
): { section: "layout"; patch: Record<string, unknown> } {
  const shape = fitInside({ width: crop.width, height: crop.height }, drawn);
  const box: Rect = {
    x: drawn.x + (drawn.width - shape.width) / 2,
    y: drawn.y + (drawn.height - shape.height) / 2,
    width: shape.width,
    height: shape.height,
  };

  const cover = Math.max(box.width / source.width, box.height / source.height);
  const level = cover > 0 && crop.width > 0 ? box.width / crop.width / cover : 1;

  const offsetX = (crop.x - (source.width - crop.width) / 2) / source.width;
  const offsetY = (crop.y - (source.height - crop.height) / 2) / source.height;

  const { patch } = boxPatch(target, true, box, frame, layout, rest);

  return {
    section: "layout",
    patch:
      target === "screen"
        ? { ...patch, screenCrop: level, screenOffsetX: offsetX, screenOffsetY: offsetY }
        : { ...patch, cameraZoom: level, cameraOffsetX: offsetX, cameraOffsetY: offsetY },
  };
}

/**
 * `crop` reflected across the middle of `source`.
 *
 * The camera is usually mirrored — the bubble somebody watched while recording
 * was — and the compositor does it by flipping the quad's own uv, so the crop
 * window stays in the file's coordinates and what is drawn is that window the
 * other way round. The crop surface shows the picture as the composition does,
 * which means the rectangle dragged on it is in *that* space and has to be
 * reflected on the way to a setting.
 *
 * Its own inverse, which is why one function covers both directions. Without
 * it, cropping the left of a mirrored face wrote the right of the file and the
 * crop landed on the other side of the person's head.
 */
export function flipCrop(crop: Rect, source: Size): Rect {
  return { ...crop, x: source.width - crop.x - crop.width };
}

/**
 * `crop` pulled back inside `source`, keeping at least a usable sliver.
 *
 * The crop surface clamps as the pointer moves rather than letting a drag leave
 * the picture and snapping back on release, which reads as the rectangle
 * fighting the hand.
 */
export function clampCrop(crop: Rect, source: Size): Rect {
  const width = Math.min(Math.max(crop.width, MIN_CROP), source.width);
  const height = Math.min(Math.max(crop.height, MIN_CROP), source.height);

  return {
    x: Math.min(Math.max(crop.x, 0), source.width - width),
    y: Math.min(Math.max(crop.y, 0), source.height - height),
    width,
    height,
  };
}

/**
 * The smallest crop, in source pixels.
 *
 * Small enough never to be in the way and large enough that a rectangle
 * dragged to nothing still has handles to pull it back out by.
 */
const MIN_CROP = 16;
