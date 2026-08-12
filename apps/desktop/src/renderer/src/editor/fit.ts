/**
 * Fitting an output frame into the space the window can spare.
 *
 * Split out from the component so the arithmetic can be checked against every
 * frame preset without a browser. The failure it guards is not subtle in
 * hindsight and was invisible in practice: a preview laid out at its intrinsic
 * size — the full output resolution — overflows the pane and is clipped, which
 * looks like a padding bug rather than a sizing one.
 */

export interface Box {
  width: number;
  height: number;
}

/**
 * The largest box with `frame`'s aspect ratio that fits inside `available`.
 *
 * Floored rather than rounded: a fitted box a fraction of a pixel too large is
 * a scrollbar or a clipped edge, and losing half a pixel of preview is not
 * something anyone can see.
 */
export function fitInside(frame: Box, available: Box): Box {
  if (frame.width <= 0 || frame.height <= 0 || available.width <= 0 || available.height <= 0) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(available.width / frame.width, available.height / frame.height);

  return {
    width: Math.max(1, Math.floor(frame.width * scale)),
    height: Math.max(1, Math.floor(frame.height * scale)),
  };
}
