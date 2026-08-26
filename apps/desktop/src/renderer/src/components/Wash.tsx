import { cn } from "../lib/cn";

/**
 * The colour at the top of a window.
 *
 * Three circles rather than a CSS gradient doing the whole job: a linear ramp
 * between two hues goes through the dead grey in the middle of them, and the
 * app's icon is a sunrise across orange, crimson and violet. Overlapping blurs
 * keep every hue at full saturation and let them mix where they meet, which is
 * what makes it read as light rather than as a fill.
 *
 * `blur-3xl` on absolutely positioned circles, not a `backdrop-filter`: this has
 * nothing behind it to filter, and a backdrop blur on the window root is a
 * compositing cost paid on every frame the editor draws.
 *
 * Low opacity and clipped to the top, so it is atmosphere behind the text rather
 * than something the text has to survive being on top of.
 *
 * Shared by the welcome window and the upgrade dialog. Two copies of it drifted
 * within a week of the second one being written, and the whole point of it is
 * that the two surfaces are recognisably the same app.
 */
export function Wash({ className }: { className?: string }) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden", className)}
      // Masked rather than merely clipped. `overflow-hidden` alone cuts the
      // circles off at the container's edge, and a blurred circle ending in a
      // straight line is the one thing that gives away that it is a rectangle
      // full of circles — it read as a seam across the window. The mask fades
      // everything inside out before the boundary, so there is no edge to see.
      style={{
        maskImage: "linear-gradient(to bottom, black 45%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, black 45%, transparent)",
      }}
      aria-hidden="true"
    >
      {/* The hue itself, fading out downwards so it has no edge to notice. */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] to-transparent" />

      {/* Pulled above the top edge so only the lower, widest part of each circle
          is in the window — a circle wholly inside reads as a dot.

          The opacities look high for something meant to be subtle, and are not:
          `blur-3xl` spreads each circle over 64px in every direction, and most of
          its area is off screen, so what actually lands in the window is a
          fraction of the figure. At half these values the wash was invisible
          against `--editor-bg`. */}
      <div className="absolute -top-20 -left-20 size-80 rounded-full bg-sunrise-warm opacity-30 blur-3xl" />
      <div className="absolute -top-24 left-1/3 size-80 rounded-full bg-sunrise-mid opacity-25 blur-3xl" />
      <div className="absolute -top-20 -right-12 size-80 rounded-full bg-sunrise-cool opacity-30 blur-3xl" />
    </div>
  );
}
