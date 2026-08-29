/**
 * The colour at the top of the page.
 *
 * Three blurred circles rather than a linear gradient doing the whole job: a ramp
 * between two hues passes through the dead grey between them, and the icon these
 * are taken from is a sunrise — orange through crimson into the clip's violet.
 * Overlapping blurs keep each hue at full saturation and let them mix only where
 * they meet, which is what reads as light rather than as a fill.
 *
 * `absolute`, not `fixed`: this belongs to the top of the *document* and should
 * scroll away with the hero. Body establishes no containing block, so `top-0`
 * resolves against the initial containing block — the document origin — and the
 * wash scrolls normally.
 *
 * `-z-10` puts it above the body's background but below everything in flow. A
 * negative-z child paints after its parent's background and before its parent's
 * content, which is exactly the layer this wants.
 */
export function Wash() {
  return (
    <div
      aria-hidden
      data-wash
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] overflow-hidden"
      // Masked rather than only clipped. `overflow-hidden` alone cuts the circles
      // off at the container's edge, and a blurred circle ending in a straight
      // line is what gives away that it is a box full of circles — it reads as a
      // seam across the page. The mask fades everything inside out before the
      // boundary, so there is no edge to notice.
      style={{
        maskImage: "linear-gradient(to bottom, black 40%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, black 40%, transparent)",
      }}
    >
      {/* A wash over the whole width first, so the circles sit in light rather
          than on the flat background. */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent" />

      {/* Pulled above the top edge so only the lower, widest part of each circle
          is on the page — a circle wholly inside reads as a dot.

          The opacities look high for something meant to be subtle and are not:
          the blur spreads each circle over a hundred pixels in every direction
          and most of its area is off screen, so what actually lands on the page is
          a fraction of the figure. */}
      <div className="animate-drift-a absolute -top-48 -left-24 size-[540px] rounded-full bg-brand-from opacity-[0.15] blur-[110px] will-change-transform" />
      <div className="animate-drift-b absolute -top-56 left-1/3 size-[600px] rounded-full bg-brand-to opacity-[0.15] blur-[110px] will-change-transform" />
      <div className="animate-drift-c absolute -top-48 -right-24 size-[540px] rounded-full bg-iris opacity-[0.12] blur-[110px] will-change-transform" />
    </div>
  );
}
