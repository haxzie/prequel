"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavItem = { href: Route; label: string; owns?: string[] };

/**
 * Where the selection sits, in pixels inside the row.
 *
 * `animate` travels with the position rather than being decided at the use
 * site: a box that is already on screen slides to the next label, and one that
 * is arriving — the cursor entering the row, the page loading on a section —
 * has nowhere to slide from and must appear where it belongs. Without the
 * flag the first hover of every visit skates the box in from whichever label
 * the last one left it on.
 */
type Frame = { x: number; w: number; animate: boolean };

/**
 * The header's section links, with the editor's selection box behind them.
 *
 * The row used to tint each label's own background on hover, which is the
 * generic answer and says nothing about what this site is. The headline above
 * it draws a word as a selected object — see `HeroCard` — so the nav borrows
 * the same marquee: one box, in the accent, that travels to whatever the
 * cursor is over and returns to the current section when it leaves.
 *
 * One box and not a background per link, because the travel is the point. Six
 * boxes fading in and out at the same time is six things happening; a single
 * box moving is a cursor, which is what the product does.
 *
 * A client component for `usePathname` and for the measuring — both of which
 * are the whole feature, so there is nothing here to keep on the server.
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const current = items.findIndex((item) => owns(item, pathname));

  const [hovered, setHovered] = useState<number | null>(null);
  // The cursor wins while it is in the row; the current section has it the
  // rest of the time. `-1` from `findIndex` means a page outside the row —
  // the home page is the usual one — and there the box simply is not drawn.
  const shown = hovered ?? (current === -1 ? null : current);

  const row = useRef<HTMLElement>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null);
  // Whether the box was on screen when this ran, read before the render that
  // moves it. A ref and not state: it decides how the next frame animates and
  // must not cause a render of its own.
  const wasShown = useRef(false);

  useEffect(() => {
    const link = shown === null ? null : links.current[shown];

    if (!link) {
      // The last frame is deliberately left in place, so the box fades out
      // where it stood rather than collapsing to the left rail on the way.
      wasShown.current = false;
      return;
    }

    const measure = (animate: boolean) =>
      setFrame({ x: link.offsetLeft, w: link.offsetWidth, animate });

    measure(wasShown.current);
    wasShown.current = true;

    // The labels are laid out by their text, so their boxes move when the font
    // swaps in and when the window changes width. Measured again on both
    // rather than once on mount, and without animating: a box sliding because
    // a webfont arrived reads as a glitch.
    const resize = new ResizeObserver(() => measure(false));
    if (row.current) resize.observe(row.current);
    return () => resize.disconnect();
  }, [shown]);

  return (
    <nav
      ref={row}
      // `relative` because the box is positioned against this row, and
      // `offsetLeft` above is read against it for the same reason.
      className="relative hidden items-center gap-1 lg:flex"
      onMouseLeave={() => setHovered(null)}
    >
      {/* The marquee. `inset-y-1` rather than a height, so it keeps the row's
          own rhythm at every text size.

          Square, and so are the marks on it. A selection in the editor is a
          rectangle dragged around something and the headline's chip quotes it
          at `0.1em`, which at this size is a corner the eye cannot find
          anyway — rounding it turns the box back into the pill this row used
          to tint on hover, which is the shape being replaced.

          `transform` and `width` and never `left`: the move is the thing the
          eye follows and a transform is composited, while an animated `left`
          lays the row out again on every frame of it. The width has to be a
          real width — `scaleX` on a box with a 1px border and four corner
          marks stretches all five. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-1 left-0 border border-accent bg-accent/8 transition-opacity duration-150 motion-reduce:transition-none ${
          shown === null ? "opacity-0" : "opacity-100"
        } ${frame?.animate ? "transition-[transform,width,opacity] duration-200 ease-out" : ""}`}
        style={frame ? { transform: `translate3d(${frame.x}px, 0, 0)`, width: frame.w } : undefined}
      >
        {/* Four corners and not the headline chip's eight. The marks are a
            fixed 4px wherever they are drawn, and on a box this size the edge
            ones land close enough to the corners to read as a dashed border
            rather than as handles. */}
        {CORNERS.map((at) => (
          <span key={at} className={`absolute size-1 border border-accent bg-bg ${at}`} />
        ))}
      </span>

      {items.map((item, i) => (
        <Link
          key={item.href}
          href={item.href}
          ref={(el) => {
            links.current[i] = el;
          }}
          onMouseEnter={() => setHovered(i)}
          // The keyboard moves the box as well. A focus ring and a selection
          // box on different labels would be two answers to "where am I".
          onFocus={() => setHovered(i)}
          onBlur={() => setHovered(null)}
          // Full `--fg` rather than muted, so the row reads as navigation
          // rather than as small print — which leaves no colour step for the
          // current section, and is why it is marked by weight. `font-medium`
          // and not semibold: the labels must not jump as the box arrives.
          aria-current={i === current ? "page" : undefined}
          className={`relative px-3 py-2 text-sm whitespace-nowrap text-fg outline-none ${
            i === current ? "font-medium" : ""
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Where the four marks sit, each centred on its corner so half of it is
    inside the box and half outside. Filled with the page's own background and
    not white, for the reason `HeroCard`'s are: the border passes behind a
    mark rather than through it. */
const CORNERS = [
  "top-0 left-0 -translate-x-1/2 -translate-y-1/2",
  "top-0 right-0 translate-x-1/2 -translate-y-1/2",
  "bottom-0 right-0 translate-x-1/2 translate-y-1/2",
  "bottom-0 left-0 -translate-x-1/2 translate-y-1/2",
];

/**
 * Whether a path belongs to a section.
 *
 * The boundary is checked with a trailing slash, so `/blog` owns `/blog/x` and
 * `/docs` does not own a future `/docs-beta`. See `owns` in `lib/site.ts` for
 * the two sections whose pages sit on a different path entirely.
 */
function owns(item: NavItem, pathname: string): boolean {
  return [item.href as string, ...(item.owns ?? [])].some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}
