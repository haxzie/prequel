/**
 * The gradual edge where scrolling content passes under something pinned.
 *
 * Without it the scroller simply stops: a line of text or the top row of a
 * swatch grid is cut clean in half at the header's underside, which reads as
 * the panel being clipped rather than as content continuing past it.
 *
 * Progressive blur rather than one blurred strip. A single `backdrop-filter`
 * has a hard edge of its own — sharp below, blurred above — which trades one
 * cut for another. Stacking a few, each masked to a band and each blurrier than
 * the last, makes the blur itself ramp: nothing at the bottom of the strip,
 * strongest where it meets whatever is above.
 *
 * The colour rides on top of that, the panel's own solid veil fading out
 * downwards, so what passes under is losing contrast as well as focus. Both
 * together are what make the content look like it is going *behind* something.
 */
import { useEffect, useRef } from "react";

import { cn } from "../../lib/cn";

/**
 * The ramp, bottom of the strip to top.
 *
 * `to` overshoots `from` on the next layer on purpose: bands that merely touch
 * leave a seam at the join, because each one's mask reaches zero exactly where
 * its neighbour does. Overlapping them means at every height some layer is at
 * full strength.
 */
const LAYERS = [
  { blur: "1px", from: 0, to: 40 },
  { blur: "2px", from: 20, to: 65 },
  { blur: "4px", from: 45, to: 85 },
  { blur: "8px", from: 70, to: 100 },
];

/**
 * The nearest ancestor that actually scrolls.
 *
 * Walked rather than passed in. This is mounted in two places — the top of the
 * panel's scroller, and under the background tabs, which are themselves inside
 * that scroller — and in both the thing to watch is simply the scroller above
 * it. Handing it down would mean threading a ref through `Tabs`, which has no
 * other reason to know it is in one.
 */
function scrollerOf(from: HTMLElement | null): HTMLElement | null {
  for (let node = from?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

export function ScrollFade({ className }: { className?: string }) {
  const anchor = useRef<HTMLDivElement>(null);

  // Only once something is actually under it. At rest the content starts flush
  // against what it is pinned below, with nothing to hide, and a blurred band
  // over the first control reads as that control being wrong rather than as
  // depth.
  //
  // Read off the scroller and written straight to the element: this fires on
  // every scroll event, and routing a boolean through state would re-render the
  // inspector to change one opacity.
  useEffect(() => {
    const element = anchor.current;
    const scroller = scrollerOf(element);
    if (!element || !scroller) return;

    const update = () => {
      element.style.opacity = scroller.scrollTop > 0 ? "1" : "0";
    };

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, []);

  return (
    // Zero height, with the strip hanging out of it. Positioning is the
    // caller's — pinned at the scroller's top for a panel with no tabs, and
    // hung off the bottom of the tab row for one that has them — and either way
    // this box takes no part in the flow it covers.
    //
    // It was an `h-8` element pulled back by `-mb-8` instead, which nets to the
    // same height but not to the same layout: the negative margin lifts
    // everything after it by 32px, and in a scroller that puts the first rows
    // above the scroll origin, where they are clipped and cannot be scrolled
    // back to.
    <div
      ref={anchor}
      aria-hidden
      className={cn(
        "pointer-events-none h-0 opacity-0",
        "transition-opacity duration-150 motion-reduce:transition-none",
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 h-8">
        {LAYERS.map((layer) => (
          <div
            key={layer.blur}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${layer.blur})`,
              // Reversed against the ramp: the blurriest layer is masked to the
              // top of the strip, where the content is about to disappear.
              maskImage: `linear-gradient(to top, transparent ${String(layer.from)}%, #000 ${String(layer.to)}%)`,
            }}
          />
        ))}

        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(to top, transparent, var(--editor-veil-solid) 95%)",
          }}
        />
      </div>
    </div>
  );
}
