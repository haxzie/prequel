/**
 * The editor's floating chrome: what it is made of, and how much room it takes.
 *
 * Its own module rather than exports from `Inspector.tsx`, which is where the
 * material started: the title bar is not part of the inspector, and reaching
 * into a two-thousand-line component for a string of utilities is how a style
 * constant comes to be copied instead of imported.
 */

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
