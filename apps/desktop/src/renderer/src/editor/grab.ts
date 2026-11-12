/**
 * Whether a picture in the preview can be grabbed, and where its ring goes.
 *
 * Apart from `Preview` for the reason `handles.ts` is: this is the decision
 * behind every ring and every gesture in the editor, it is a handful of
 * branches over a plan, and each branch is one that has been got wrong — a
 * picture that could not be picked up, or one that fought the drag. None of
 * them announces itself on screen as a bug in *this*.
 */
import {
  pictureDrawn,
  plateDrawn,
  type PlanSource,
  type Rect,
  type RenderPlan,
} from "../../../shared/layout";

/**
 * A picture as a gesture sees it: where it is drawn, what its settings say, and
 * which of the two a drag can actually write.
 *
 * The editor used to refuse a picture entirely while a zoom had it — no ring,
 * no handles, and a click that deselected. The refusal was aimed at one real
 * problem, that the box a drag writes is the resting box and not what is on
 * screen, and it caught two cases that are not that problem at all:
 *
 * - **The camera.** Shrink-on-zoom takes the bubble towards the corner it is
 *   parked in, and its position still comes straight from `cameraX`/`cameraY`:
 *   move the resting box a hundred pixels and the shrunken bubble moves a
 *   hundred pixels. Only its *size* is scaled, so only a resize has to be
 *   divided by anything — which is what `scale` is for.
 * - **A shot that moves the window.** Wherever the arrangement crops, the card
 *   holds still and the shot travels through the recording instead — see
 *   `shotTrack`. The rectangle on screen is exactly the resting box, so every
 *   gesture is the gesture it always was.
 *
 * What is left is a shot that moves the *card*, and there a drag genuinely has
 * nothing to write: the shot puts the point it is aimed at in the middle of the
 * frame, so where the picture lands does not depend on `screenX` at all, and a
 * move would be a gesture the next frame undoes. That one is `drag: false` —
 * still selectable, still ringed where it is, with no handles on it.
 */
/** What `grabbed` answers with. */
export interface Grabbed {
  box: Rect;
  rest: Rect;
  scale: number;
  drag: boolean;
  /**
   * Where the hole sits in `box`, as fractions of it — present only on a
   * camera wearing a frame, where `box` is the plate rather than the picture.
   *
   * Absent is "the box *is* the picture", which is every other grabbable thing
   * in the editor.
   */
  aperture?: { x: number; y: number; width: number; height: number };
}

export function grabbed(
  plan: RenderPlan,
  which: PlanSource,
  at: number,
  /** The box the settings put it in, when the plan has nothing to say. */
  fallback: Rect | null,
  /** Whether this moment is inside the move the clip opens with. */
  arriving: boolean,
): Grabbed | null {
  const drawn = pictureDrawn(plan, which, at);
  if (!drawn) return fallback ? { box: fallback, rest: fallback, scale: 1, drag: true } : null;

  /**
   * The plate, where the camera is wearing one.
   *
   * A framed camera is grabbed by its frame, not by the photograph in it:
   * handles inside a polaroid's paper look like a mistake, and the turn they
   * offer would be about the photograph's middle while the object plainly
   * turns about its own. So the gesture works in the plate's box and
   * `aperture` is what converts a pulled one back — see `Grabbed`.
   */
  const plate = which === "camera" ? plateDrawn(plan, at) : null;

  // A picture travelling in from the clip before it is the one case where
  // being away from the resting box is not a shot having taken it — see
  // `arrivingAt`. The move ends at that box, so it is exactly what a drag
  // writes, and the picture is only passing through on the way to it.
  //
  // Ringed where it is *going* rather than where it is passing through, which
  // is the one place in here the ring leaves the picture. For the few frames
  // this covers it is the lesser of two wrongs: handles hugging a travelling
  // picture would write a box computed from a position the next frame has
  // already left, which is the picture fighting the drag.
  // Where the hole sits in the plate, as fractions of it. Taken from the two
  // resting boxes rather than from the catalogue, so this file needs no table
  // of frames — and so a box pulled in plate space converts back with
  // arithmetic that cannot disagree with the plan it came from.
  const aperture =
    plate && plate.rest.width > 0 && plate.rest.height > 0
      ? {
          x: (drawn.rest.x - plate.rest.x) / plate.rest.width,
          y: (drawn.rest.y - plate.rest.y) / plate.rest.height,
          width: drawn.rest.width / plate.rest.width,
          height: drawn.rest.height / plate.rest.height,
        }
      : null;

  if (arriving) {
    return {
      box: plate?.rest ?? drawn.rest,
      rest: drawn.rest,
      scale: 1,
      drag: true,
      ...(aperture ? { aperture } : {}),
    };
  }

  return {
    box: plate?.rect ?? drawn.rect,
    // The *picture's* resting box, even where `box` is the plate: the shrink a
    // zoom applies is anchored on the picture's own margins, and
    // `restingForDrawn` inverts exactly that. A plate's margins are different
    // numbers, so inverting with them would be a different function — which is
    // why the editor converts between the two boxes rather than working in one.
    rest: drawn.rest,
    // Per picture rather than per axis: both are scaled together — the camera's
    // shrink keeps the bubble's proportions and a shot scales the card by its
    // level — and one number is one thing for a resize to divide by. Off the
    // picture, because the plate scales with it exactly.
    scale: drawn.rest.width > 0 ? drawn.rect.width / drawn.rest.width : 1,
    drag: which === "camera" || !drawn.card,
    ...(aperture ? { aperture } : {}),
  };
}

/**
 * A box pulled in plate space, restated as the picture's.
 *
 * The leaves a drag writes are the camera's — `cameraX`, `cameraWidth` — and
 * those describe the hole, not the paper round it. The hole keeps its place in
 * the plate through any resize, so this is the same four fractions applied to
 * wherever the plate has got to.
 */
export function apertureOf(plate: Rect, hole: NonNullable<Grabbed["aperture"]>): Rect {
  return {
    x: plate.x + hole.x * plate.width,
    y: plate.y + hole.y * plate.height,
    width: hole.width * plate.width,
    height: hole.height * plate.height,
  };
}

/** And back: the plate a picture of this box would be hung in. */
export function plateFor(aperture: Rect, hole: NonNullable<Grabbed["aperture"]>): Rect {
  const width = aperture.width / hole.width;
  const height = aperture.height / hole.height;
  return {
    x: aperture.x - hole.x * width,
    y: aperture.y - hole.y * height,
    width,
    height,
  };
}
