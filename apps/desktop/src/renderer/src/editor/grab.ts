/**
 * Whether a picture in the preview can be grabbed, and where its ring goes.
 *
 * Apart from `Preview` for the reason `handles.ts` is: this is the decision
 * behind every ring and every gesture in the editor, it is a handful of
 * branches over a plan, and each branch is one that has been got wrong — a
 * picture that could not be picked up, or one that fought the drag. None of
 * them announces itself on screen as a bug in *this*.
 */
import { pictureDrawn, type PlanSource, type Rect, type RenderPlan } from "../../../shared/layout";

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
export function grabbed(
  plan: RenderPlan,
  which: PlanSource,
  at: number,
  /** The box the settings put it in, when the plan has nothing to say. */
  fallback: Rect | null,
  /** Whether this moment is inside the move the clip opens with. */
  arriving: boolean,
): { box: Rect; rest: Rect; scale: number; drag: boolean } | null {
  const drawn = pictureDrawn(plan, which, at);
  if (!drawn) return fallback ? { box: fallback, rest: fallback, scale: 1, drag: true } : null;

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
  if (arriving) return { box: drawn.rest, rest: drawn.rest, scale: 1, drag: true };

  return {
    box: drawn.rect,
    rest: drawn.rest,
    // Per picture rather than per axis: both are scaled together — the camera's
    // shrink keeps the bubble's proportions and a shot scales the card by its
    // level — and one number is one thing for a resize to divide by.
    scale: drawn.rest.width > 0 ? drawn.rect.width / drawn.rest.width : 1,
    drag: which === "camera" || !drawn.card,
  };
}
