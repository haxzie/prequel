/**
 * What the editor's floating things are made of.
 *
 * One constant rather than the same four utilities written out wherever
 * something has to sit on top of the board. They are meant to be one material —
 * the dock, the inspector, and each group of controls in the title bar — and
 * they drift the moment they are written apart: the dock carried a tight shadow
 * and the panel a deep one for exactly as long as the two were separate
 * strings, and at a glance that read as two different surfaces rather than as
 * one at two sizes.
 *
 * The shadow is deliberately slight. These float over a board lit by the
 * recording's own colours, and a deep shadow puts a dark halo around each of
 * them — which is a hole punched in the light rather than an object resting on
 * it. Enough to lift, and no more.
 *
 * Its own module rather than an export from `Inspector.tsx`, which is where it
 * started: the title bar is not part of the inspector, and reaching into a
 * two-thousand-line component for a string of utilities is how a style constant
 * comes to be copied instead of imported.
 */
export const FLOATING =
  "border border-editor-line bg-editor-scrim backdrop-blur-2xl " +
  "shadow-[0_2px_10px_rgba(0,0,0,0.28)]";
