/**
 * The editor's floating chrome: what it is made of, and how much room it takes.
 *
 * Its own module rather than exports from `Inspector.tsx`, which is where the
 * material started: the title bar is not part of the inspector, and reaching
 * into a two-thousand-line component for a string of utilities is how a style
 * constant comes to be copied instead of imported.
 */

import type { Handle } from "./handles";

/**
 * How tall the editor's title bar is.
 *
 * A constant because four things have to agree on it, and three of them are not
 * the bar: it floats over the board rather than sitting above it — which is
 * what lets the dots and the background's own light run to the top of the
 * window — so everything underneath has to keep clear of it itself. The frame
 * bar sits below it, the inspector starts below it, and the stage's headroom is
 * this plus its own. In rem because one of those is a `calc` on it.
 */
export const TITLE_BAR = "2.625rem";

/**
 * How tall the frame bar is.
 *
 * Measured from the thing rather than imposed on it — the bar is a row of
 * controls and its height comes from them — so this is a number to keep in step
 * with it, and the one thing that reads it is the stage's headroom. It has to
 * be here because the bar floats: the board runs the full height of the window
 * so the dots and the light reach the top, which means nothing above the
 * picture takes a row, which means the picture has to hold its own space clear.
 */
export const FRAME_BAR = "2.375rem";

/**
 * How tall the screenshot editor's tool row is.
 *
 * `FRAME_BAR`'s counterpart at the other end of the board, and here for exactly
 * the same reason: the bar floats over the composition rather than taking a row
 * under it, so the stage has to hold its own space clear.
 *
 * Measured from the thing rather than imposed on it, and the arithmetic is
 * worth writing down because it is two short of the obvious answer: a 32px
 * button, a 2px tray around it and 6px of pill either side come to 48, and the
 * hairline `FLOATING` draws adds the last two.
 */
export const ANNOTATE_BAR = "3.125rem";

/**
 * What the editor's floating things are made of.
 *
 * One constant rather than the same four utilities written out wherever
 * something has to sit on top of the board. They are meant to be one material —
 * the dock and the inspector — and they drift the moment they are written
 * apart: the dock carried a tight shadow and the panel a deep one for exactly
 * as long as the two were separate strings, and at a glance that read as two
 * different surfaces rather than as one at two sizes.
 *
 * The title bar's groups wore it for a while and do not any more. What is up
 * there is the window saying where you are, not controls waiting to be used,
 * and three plates across the top made the bar compete with the picture under
 * it. They light up on hover instead, which is the only moment any of them is
 * a control.
 *
 * The shadow is deliberately slight. These float over a board lit by the
 * recording's own colours, and a deep shadow puts a dark halo around each of
 * them — which is a hole punched in the light rather than an object resting on
 * it. Enough to lift, and no more.
 *
 * The blur is wide — wider than it needs to be to read as frost — and that is
 * what keeps the three looking like one material. A backdrop filter samples
 * what is immediately behind the element, so a 48px dock sitting on a lamp
 * picks up a hot spot while a 320px panel beside it averages the lamp and the
 * dark board either side of it. At this radius each of them is averaging far
 * more than it covers, so they converge instead of reporting whatever happens
 * to be under them.
 */
export const FLOATING =
  "border border-editor-line bg-editor-scrim backdrop-blur-3xl " +
  "shadow-[0_2px_10px_rgba(0,0,0,0.28)]";

/**
 * What a selected thing in the composition is ringed with.
 *
 * The app's own blue — `--selected`, the same colour a switch turns and a clip
 * on the timeline is outlined in. One constant because two surfaces draw it
 * now: the preview's ring around a picture, and the crop surface's window on
 * the take. They are the same gesture on the same kind of box, and a handle
 * that was white in one and blue in the other read as two different tools.
 */
export const SELECTION_RING = "border border-selected";

/**
 * One of the eight handles on a selected box.
 *
 * Here rather than in `Preview`, for the reason the material above is: reaching
 * into a two-thousand-line component for a string of utilities is how a style
 * constant comes to be copied instead of imported, and this one has already
 * been copied once.
 */
export const SELECTION_HANDLE =
  "absolute size-2 rounded-[2px] border border-selected bg-white shadow-sm";

/**
 * Where each handle sits on the ring.
 *
 * Four and a half pixels out, not four. An absolutely positioned child is
 * placed against its container's *padding* box, and the ring has a 1px border
 * — so an 8px handle at -4px centres half a pixel inside the stroke rather
 * than on it. Every offset is pulled the same way, which is what makes the
 * eight of them read as tucked into the box instead of sitting on its edge.
 * Half the handle, plus half the stroke.
 *
 * The midpoints need no such correction: `left-1/2` is half the padding box,
 * which with the border on both sides is the border box's middle exactly. The
 * margin there is half the handle and nothing else — by margin rather than a
 * transform, because the ring itself is moved with `transform` every frame and
 * a second one on a child is a separate property that reads as the same thing.
 */
export const HANDLE_AT: Record<Handle, string> = {
  nw: "-top-[4.5px] -left-[4.5px]",
  ne: "-top-[4.5px] -right-[4.5px]",
  se: "-right-[4.5px] -bottom-[4.5px]",
  sw: "-bottom-[4.5px] -left-[4.5px]",
  n: "-top-[4.5px] left-1/2 -ml-1",
  s: "-bottom-[4.5px] left-1/2 -ml-1",
  w: "-left-[4.5px] top-1/2 -mt-1",
  e: "-right-[4.5px] top-1/2 -mt-1",
};
