/**
 * The two vertical lines the page is written between.
 *
 * Fixed rather than drawn per section: a `border-x` on each section's container
 * would break wherever a section's vertical padding sits outside it, leaving a
 * dashed line down the page instead of a continuous one.
 *
 * Painted *above* the content for the same reason. Full-bleed bands like the
 * product stage have their own background, and anything behind them would be
 * covered exactly where the rails need to keep going. They sit at the container
 * edge, outside its padding, so a one-pixel line over the content layer never
 * lands on anything — and `z-40` keeps them under the floating header.
 */
export function Rails() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 flex justify-center">
      <div className="w-full max-w-6xl border-x border-white/10" />
    </div>
  );
}
