"use client";

import { useState } from "react";

import {
  DEFAULT_POINTER,
  POINTER_COUNT,
  POINTERS,
  type PointerStyle,
  TAG_NAME,
} from "@/lib/playables";

import { POINTER_STAGE } from "@/components/landing/stage";

import { ChalkMark } from "./ChalkMark";
import { PlayCard, Stage } from "./PlayCard";

/**
 * Where the pointer stops, and when it presses there.
 *
 * These are `pointer-drift`'s own stops in `globals.css`, written out again so
 * the marks can be put where the pointer will be. A keyframe cannot be read
 * back, so the two have to agree by being the same numbers — change one and
 * change the other, or the chalk lands where nobody knocked.
 *
 * `at` is the fraction of the 11s cycle the pointer arrives at that stop,
 * which is the mark's delay: the pointer dips and the dust appears together.
 */
const CYCLE_S = 11;

/**
 * Where the pointer's tip sits on the stage, for both the pointer and the
 * marks it leaves. Far enough in that the stops below it stay on the card and
 * the dust has somewhere to rise.
 */
const TIP = { left: "28%", top: "26%" };

/** The sprite's own size. Most of it is rod and most of that is off the card. */
const SPRITE = 820;

/** The hotspots `CURSOR_STYLES` records, which is what makes a tip a tip. */
const STICK_HOTSPOT = { x: 0.045, y: 0.025 };
const TAG_SIZE = 44;
const TAG_HOTSPOT = { x: 0.0696, y: 0.0752 };

const STOPS = [
  { x: 0, y: 0, at: 0.065 },
  { x: 92, y: 44, at: 0.245 },
  { x: 34, y: 86, at: 0.505 },
  { x: 126, y: 10, at: 0.745 },
];

/**
 * The pointers, picked the way they are picked in the app.
 *
 * Playing this one is choosing: press a tile and the pointer on the stage
 * becomes it, which is the whole of the feature. There is no sound and no
 * timeline, so a play button would be a control with nothing to start — the
 * tiles are the control.
 *
 * The stage is a window rather than a plain panel because a pointer only means
 * anything over something: on an empty card a glove is a sticker, and over a
 * row of list items it is somebody pointing at one.
 */
export function PointerCard() {
  const [picked, setPicked] = useState<PointerStyle>(DEFAULT_POINTER);

  return (
    <PlayCard
      title="Pointers"
      body={`Swap the recorded pointer for one of ${POINTER_COUNT}, at a size you set. A hand on a stick for a lesson, or a named arrow for a walkthrough.`}
    >
      <Stage className="h-[236px] overflow-hidden">
        {/* The desktop, and nothing on it. There was a screen capture standing
            here as well — a window for the pointer to be over — and two
            pictures in a 236px box left the pointer competing with a Twitch
            stream for the one thing the card is about. The wallpaper is one
            the app's own picker ships; see `stage.ts`. */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${POINTER_STAGE})` }}
        />

        {/* The marks, under the pointer and over the wallpaper.

            Anchored on `TIP` — the same point the pointer itself hangs from —
            so a mark lands exactly where the tip was. Each stop takes its own
            offset as a static `translate` and the mark animates inside it. */}
        <span aria-hidden className="pointer-events-none absolute size-0" style={TIP}>
          {STOPS.map((stop) => (
            <span
              key={`${stop.x}-${stop.y}`}
              className="absolute size-0"
              style={{ translate: `${stop.x}px ${stop.y}px` }}
            >
              {picked.kind === "stick" ? (
                <ChalkMark delay={`${stop.at * CYCLE_S}s`} />
              ) : (
                <span
                  className="animate-ripple-mark absolute rounded-full border-white/85 opacity-0"
                  style={{
                    width: 56,
                    height: 56,
                    marginLeft: -28,
                    marginTop: -28,
                    animationDelay: `${stop.at * CYCLE_S}s`,
                  }}
                />
              )}
            </span>
          ))}
        </span>

        {/* The pointer, hung from its own hotspot.

            A zero-sized box at `TIP` with the sprite offset off it, rather
            than the sprite positioned directly: a pointer's position *is* its
            hotspot, and on a stick that hotspot is 4.5% across and 2.5% down —
            a point near the sprite's top-left corner, well above and left of
            the glove you can see. Placing the sprite by eye put it somewhere
            plausible and the chalk somewhere else, because the marks are
            placed from the hotspot and the sprite was not.

            Everything the pointer does hangs off this box: it drifts, it dips
            at each stop, and it pops on arrival — see `.animate-pointer`. The
            box is the hotspot, so the dip pivots on the tip the way a press
            does. */}
        <span
          key={picked.art}
          className="animate-pointer pointer-events-none absolute size-0"
          style={TIP}
        >
          {picked.kind === "stick" ? (
            /* The whole sprite, not the tile's crop: a hand on a rod that
               leaves the frame. That is what the pointer *is* — the app draws
               the rod long enough to reach the edge from anywhere in the
               picture, so it never has a visible end — and a stick floating
               with both ends inside the box is a prop lying on a desk.

               Its natural size in pixels rather than a percentage of the card.
               A percentage here resolved against the stage and made the rod's
               angle depend on the breakpoint; the sprite is drawn at 640 and
               the card crops whatever does not fit, which is most of it. */
            <img
              src={`/cursors/${picked.stage}.png`}
              alt=""
              width={SPRITE}
              height={SPRITE}
              draggable={false}
              className="absolute max-w-none select-none drop-shadow-[0_4px_10px_rgb(0_0_0_/_0.5)]"
              style={{
                width: SPRITE,
                marginLeft: -SPRITE * STICK_HOTSPOT.x,
                marginTop: -SPRITE * STICK_HOTSPOT.y,
              }}
            />
          ) : (
            <span
              className="absolute flex items-start drop-shadow-[0_3px_6px_rgb(0_0_0_/_0.45)]"
              style={{
                marginLeft: -TAG_SIZE * TAG_HOTSPOT.x,
                marginTop: -TAG_SIZE * TAG_HOTSPOT.y,
              }}
            >
              <img
                src={`/cursors/${picked.art}.png`}
                alt=""
                width={128}
                height={128}
                draggable={false}
                className="max-w-none select-none"
                style={{ width: TAG_SIZE, height: TAG_SIZE }}
              />
              {/* The name, drawn rather than baked into the art — which is how
                  the app does it too: the arrow is a PNG and `cursorTag.ts`
                  renders the pill in Chromium, because the exporter has no
                  font engine. Offset down and right of the tip, at the
                  proportions that file measured off a multiplayer canvas. */}
              <span
                className="-ml-1.5 translate-y-7 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white"
                style={{ background: picked.tag }}
              >
                {TAG_NAME}
              </span>
            </span>
          )}
        </span>
      </Stage>

      {/* Two rows of five: the sticks and then the tags, which is the order
          `CURSOR_STYLES` has them in and the division anybody picking one is
          actually making. */}
      <div className="grid grid-cols-5 gap-1.5 p-4">
        {POINTERS.map((pointer) => (
          <button
            key={pointer.art}
            type="button"
            onClick={() => setPicked(pointer)}
            title={pointer.label}
            aria-label={pointer.label}
            aria-pressed={picked.art === pointer.art}
            // Each tile is a square card of its own — the same border,
            // surface and top lip every panel on the page carries — rather
            // than a tinted cell in a grid. Square because the art is: a
            // 128px square sprite in a wide cell is a picture with a margin
            // down both sides, and ten of those read as a table rather than
            // as ten things to choose between.
            //
            // The selected state moves the border rather than adding a ring.
            // A ring is drawn outside the box, so a selected tile grew by two
            // pixels and nudged the row.
            className={`squircle lit relative grid aspect-square place-items-center rounded-xl border transition-colors ${
              picked.art === pointer.art
                ? "border-accent bg-accent/12"
                : "border-line bg-surface hover:border-fg/20"
            }`}
          >
            <img
              src={`/cursors/${pointer.art}.png`}
              alt=""
              width={128}
              height={128}
              draggable={false}
              className="size-11 select-none"
            />
          </button>
        ))}
      </div>
    </PlayCard>
  );
}
