import type { CSSProperties, ReactNode } from "react";

import { EditorSurface } from "@/components/editor-controls";
import {
  CAMERA_STILL,
  CAPTIONS_STAGE,
  LAYOUT_SCREEN,
  LAYOUT_STAGE,
  ZOOM_STAGE,
} from "@/components/landing/stage";

/**
 * The pieces every picture on `/features` is put together from.
 *
 * The page is nine bento grids and every card in them opens on a picture, the
 * way the three steps on the home page do. `step-visuals.tsx` is the model:
 * each one is a corner of the app on one of the app's own wallpapers, cropped
 * so the part the card is about is what fills the frame. At 160px tall a whole
 * editor is a grey rectangle; a crop of the one control reads at a glance.
 *
 * Nothing here moves. The home page's demos animate because a push in or a
 * word landing is a motion a still cannot show. Forty loops beside forty
 * paragraphs is movement in the corner of the eye of somebody trying to read,
 * so none of these needs `motion-reduce` either.
 *
 * Everything is `aria-hidden` at the card, not here. The card's title and body
 * carry the meaning; forty descriptions of drawn interface corners read out one
 * after another is noise in place of the two lines beside each.
 */

/**
 * The wallpaper a card stands on.
 *
 * Three, so that neighbours in a grid can differ: two cards side by side on the
 * same ground read as one picture cut in half, which is the argument
 * `stage.ts` makes for the home page demos. A card names its stage rather than
 * being dealt one, because which neighbours a card has is a layout decision the
 * grid makes and the pictures should be checked against it.
 */
export type Stage = "sequoia" | "facet" | "peony";

const STAGES: Record<Stage, string> = {
  sequoia: ZOOM_STAGE,
  facet: LAYOUT_STAGE,
  peony: CAPTIONS_STAGE,
};

/**
 * The frame a picture is cropped to.
 *
 * `h-40` for a regular or a wide card, so that every picture in a row sits at
 * one height whatever the card's width — a row where the wide card's picture
 * is taller than its neighbour's reads as two card designs rather than one
 * grid. A tall card passes `fill` instead, and the picture takes whatever the
 * two rows it spans leave after its own text. Below `lg` a tall card is an
 * ordinary cell, and `min-h-64` is what keeps a panel drawn for two rows from
 * being cut off at the second slider.
 *
 * `bg-center`, not `bg-centre`. The comments and copy in this repo are British
 * and the hand carries it into class names, where Tailwind has no such utility
 * and the wallpaper silently anchors top left instead.
 */
export function Frame({
  stage,
  fill = false,
  className = "",
  children,
}: {
  stage: Stage;
  fill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-cover bg-center ${
        fill ? "min-h-64 flex-1" : "h-40 shrink-0"
      } ${className}`}
      style={{ backgroundImage: `url(${STAGES[stage]})` }}
    >
      {children}
    </div>
  );
}

/**
 * A screen recording, framed the way the app frames one: rounded, with a
 * shadow on the wallpaper and a hairline to hold its edge against a light
 * ground.
 *
 * A real capture rather than a window drawn in CSS, for the reason the home
 * page's demos switched: a drawn window says "a recording would go here" and a
 * capture says this is what the tool does to your work. `bg-top` so the crop
 * keeps the window's chrome, which is what makes it read as a screen.
 */
export function Screen({
  src = LAYOUT_SCREEN,
  className = "",
  style,
  children,
}: {
  src?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={`absolute overflow-hidden rounded-lg bg-cover bg-top ring-1 ring-black/10 ${className}`}
      style={{
        backgroundImage: `url(${src})`,
        boxShadow: "0 18px 40px -18px rgb(0 0 0 / 0.55)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The camera, as the app's default bubble.
 *
 * `squircle` *and* `rounded-full`: `corner-shape` reshapes a radius rather than
 * supplying one, so on its own it is a square. The pair is the app's own
 * squircle, whose `SHAPE_RADIUS` is half the shorter edge. A border and not a
 * ring, because `corner-shape` is a property of the box and a ring is drawn
 * outside it and comes back round.
 */
export function Bubble({
  className = "",
  style,
  shape = "squircle rounded-full",
  edge = "border-2",
}: {
  className?: string;
  style?: CSSProperties;
  /** The corner treatment, for the card that shows all five. */
  shape?: string;
  /**
   * The border's width. A prop rather than a class in `className`, because a
   * `border` passed alongside the default `border-2` is two width utilities on
   * one element and which wins is stylesheet order.
   */
  edge?: string;
}) {
  return (
    <div
      className={`absolute border-white bg-cover bg-center ${edge} ${shape} ${className}`}
      style={{
        backgroundImage: `url(${CAMERA_STILL})`,
        boxShadow: "0 10px 22px -8px rgb(0 0 0 / 0.6)",
        ...style,
      }}
    />
  );
}

/**
 * A slab of the editor, standing on the wallpaper.
 *
 * `EditorSurface` turns on `editor-theme`, which is the only place the
 * `--editor-*` and `--slice-*` colours have values; the controls inside are
 * transparent anywhere else. Positioned by the caller so it can bleed off an
 * edge — a panel with air on every side is a diagram of a panel, and one
 * running out of the frame is a window that carries on.
 */
export function Slab({
  className = "",
  inner = "",
  children,
}: {
  /** Where the slab sits: insets, and a width if it has one. */
  className?: string;
  /** How the slab lays its contents out: padding, a flex column. */
  inner?: string;
  children: ReactNode;
}) {
  // Two boxes rather than one, because `EditorSurface` is `relative` and the
  // slab has to be `absolute`. Both are position utilities and which one wins
  // is the order they land in the stylesheet, which is not a thing to lean on.
  return (
    <div className={`absolute ${className}`}>
      <EditorSurface className={`size-full ${inner}`}>{children}</EditorSurface>
    </div>
  );
}

/**
 * A short label over a picture: a size, a state, a count.
 *
 * Dark on anything, because the wallpapers run from a pale peony to a deep
 * blue and a chip has to survive both. Mono, at the size the app prints a
 * reading in, so it reads as the app's own annotation and not the site's.
 */
export function Chip({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={`absolute flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[10px] whitespace-nowrap text-white/90 backdrop-blur-sm [&_svg]:size-3 ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * One key of a shortcut, drawn as a keycap.
 *
 * A keycap rather than the text `⇧⌘R`, because three glyphs in a row read as
 * a word to anyone who does not already know them, and a row of caps reads as
 * something pressed.
 *
 * Dark caps with white legends, for the reason `Chip` is dark: these sit on a
 * recording as often as on a wallpaper, and a frosted white cap on a white
 * web page is three blank squares.
 */
export function Key({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-7 min-w-7 place-items-center rounded-md border border-white/20 bg-black/60 px-1.5 font-mono text-[12px] text-white shadow-[0_1px_0_rgb(255_255_255_/_0.15)_inset,0_2px_4px_rgb(0_0_0_/_0.35)] backdrop-blur-sm">
      {children}
    </span>
  );
}

/**
 * A pointer, from the app's own artwork.
 *
 * The fifteen files under `public/cursors` are copies of the PNGs the app
 * draws with, 128px square, so the pointer on the page is the pointer in the
 * export. Sized by the caller: the app sizes it as a fraction of the frame's
 * shorter edge, and there is no frame here to take a fraction of.
 */
export function Pointer({
  art = "modern-black",
  className = "",
  style,
}: {
  /** Which of the fifteen: the file's name under `public/cursors`. */
  art?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <img
      src={`/cursors/${art}.png`}
      alt=""
      width={128}
      height={128}
      draggable={false}
      className={`pointer-events-none absolute select-none ${className}`}
      style={style}
    />
  );
}
