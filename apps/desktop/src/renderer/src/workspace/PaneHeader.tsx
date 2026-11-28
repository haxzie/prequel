import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * The bar at the top of a library pane.
 *
 * Shared rather than repeated per pane because it does two jobs beyond saying
 * what is on screen: it is the window's drag region, and its height is what
 * keeps every pane's first row level with the sidebar's, whose own top padding
 * is holding the traffic lights out of the content.
 *
 * **It floats over the pane rather than taking a row above it.** As a row it
 * was a band the list could not reach, closed off with a hairline — and a rule
 * across the window is the one thing in here that is still a wall. Over the
 * top, the pane is one surface and the content passes under the bar, which is
 * what the blur behind it is for: the rows dissolve into it as they go rather
 * than disappearing at an edge. Every pane leaves `PANE_HEADROOM` at the top of
 * its own scroller so nothing starts underneath it.
 */
export function PaneHeader({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** Anything the pane wants at the far right — a count, a control. */
  children?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "drag absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-5",
        PANE_HEADER_HEIGHT,
      )}
    >
      <ProgressiveBlur />
      {/* Positioned, so it paints over the blur stack above rather than under
          it — both are positioned and the later one wins. */}
      <span className="relative flex items-center gap-2 text-[15px] font-medium [&_svg]:size-[18px]">
        {icon}
        {title}
      </span>
      <span className="flex-1" />
      <span className="relative flex items-center gap-3">{children}</span>
    </header>
  );
}

/**
 * How tall the bar is, and the room a pane has to leave for it.
 *
 * As padding on the scroller rather than a margin or a spacer, and that choice
 * is load-bearing twice over. A scroller's top padding scrolls away with its
 * content, so the rows reach the top of the scrollport and pass under the bar,
 * which is the whole point of the blur. And a sticky row inside it — the list
 * views' column heads — is held inside the scrollport *shrunk by that padding*,
 * so `top-0` stops it exactly under the bar with no second number to keep in
 * step. Given `top-[52px]` as well it stopped 52px lower still, sitting on the
 * first row at rest.
 */
export const PANE_HEADER_HEIGHT = "h-[52px]";
export const PANE_HEADROOM = "pt-[52px]";

/**
 * The blur behind the bar, strongest at the top and gone by the bottom edge.
 *
 * One `backdrop-filter` is a pane of frosted glass with an edge on it: the
 * content is sharp, then it is blurred, and the line where it changes is as
 * hard as the border this replaced. A ramp has no such line — which is the
 * whole point, because there is nothing else separating the bar from the rows
 * passing under it.
 *
 * A ramp is not something `backdrop-filter` can express, so it is built out of
 * layers: each one blurs by half as much as the one above it and is masked to
 * its own band, and the bands overlap. What a pixel ends up with is every layer
 * that covers it, so the strength falls away smoothly from the top — sixteen
 * pixels of blur at the title, two at the last row of the band, none below it.
 *
 * The tint is the other half. Blurred dark rows are still dark rows, and a
 * white title over a light frame of somebody's screen needs something behind
 * it; a wash that fades on the same ramp gives it one without drawing an edge.
 */
function ProgressiveBlur() {
  return (
    // `pointer-events-none`, or the stack would take the presses that move the
    // window — the bar is the drag region, and these cover all of it.
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {LAYERS.map((layer) => (
        <span
          key={layer.blur}
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${String(layer.blur)}px)`,
            maskImage: `linear-gradient(to bottom, ${layer.mask})`,
          }}
        />
      ))}
      <span
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--color-editor-scrim) 72%, transparent), transparent)",
        }}
      />
    </span>
  );
}

/**
 * The four bands, from the top down. Each is held at full strength across its
 * own quarter and fades into its neighbours, so no two of them meet at a line.
 */
const LAYERS = [
  { blur: 16, mask: "black 0%, black 25%, transparent 50%" },
  { blur: 8, mask: "transparent 10%, black 35%, black 50%, transparent 75%" },
  { blur: 4, mask: "transparent 35%, black 60%, black 75%, transparent 95%" },
  { blur: 2, mask: "transparent 60%, black 85%, black 100%" },
] as const;
