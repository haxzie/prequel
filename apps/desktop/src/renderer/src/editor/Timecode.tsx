import { useEffect, useRef, useState } from "react";

import { registerTicker } from "../lib/ticker";

/**
 * A timecode whose digits slide as they change.
 *
 * **Only the slow ones.** The format is `m:ss.cc`, and during playback the
 * hundredths change on every frame — a digit given 180ms to travel while its
 * value changes every 16 is not an odometer, it is a smear that never settles.
 * So everything left of the point slides and everything right of it is written
 * straight in, which is also where the eye is not: the hundredths are read when
 * the picture is still, and the seconds are what moves.
 *
 * Nothing here re-renders per frame. The playback loop writes through
 * `registerTicker`, and each change is a `transform` on one column — a
 * composited property, no layout read, in a loop that is already the busiest
 * thing in the app. React is involved once, when the *shape* of the value
 * changes: `9:59.99` to `10:00.00` is a new cell, and that happens once a
 * minute rather than once a frame.
 */
export function Timecode({
  elementRef,
  initial,
  className,
  style,
}: {
  /** The playback loop's own ref. It holds the element and writes to it. */
  elementRef: (element: HTMLElement | null) => void;
  initial: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  /**
   * The value's shape, not its value.
   *
   * Held as state because the cells are React's to draw, and re-rendered only
   * when the number of characters changes.
   */
  const [shape, setShape] = useState(initial);

  const host = useRef<HTMLSpanElement | null>(null);
  const label = useRef<HTMLSpanElement | null>(null);
  const cells = useRef<(Cell | null)[]>([]);
  /** What is on screen, so an unchanged digit is not touched at all. */
  const showing = useRef(initial);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    return registerTicker(element, (text) => {
      // A different number of characters is a different set of cells, and only
      // React can add one. Rare: once a minute at the very most.
      if (text.length !== showing.current.length) {
        showing.current = text;
        if (label.current) label.current.textContent = text;
        setShape(text);
        return;
      }

      if (label.current) label.current.textContent = text;

      for (let index = 0; index < text.length; index += 1) {
        if (text[index] === showing.current[index]) continue;
        cells.current[index]?.set(text[index]!);
      }

      showing.current = text;
    });
  }, [shape]);

  return (
    <span
      ref={(element) => {
        host.current = element;
        elementRef(element);
      }}
      className={className}
      style={style}
    >
      {/* The value as text, for anything that reads the tree rather than looks
          at it: the columns below are ten digits deep and would otherwise be
          read out as such. Not a live region — a readout that changes sixty
          times a second must not be announced sixty times a second — so it is
          there to be found rather than to interrupt. */}
      <span ref={label} className="sr-only" />

      {[...shape].map((character, index) => (
        <Character
          key={index}
          character={character}
          // Left of the point only. See the note at the top.
          sliding={!shape.slice(0, index).includes(".")}
          ref={(cell) => {
            cells.current[index] = cell;
          }}
        />
      ))}
    </span>
  );
}

/** What the writer above holds onto for each character. */
interface Cell {
  set: (character: string) => void;
}

/**
 * One character: a sliding column for a digit, plain text for anything else.
 *
 * The column is the ten digits stacked, moved by whole lines. Every digit is
 * drawn, so what passes during the slide is the real neighbouring numbers
 * rather than a cross-fade between two — which is what makes it read as a
 * wheel turning instead of one glyph becoming another.
 */
function Character({
  character,
  sliding,
  ref,
}: {
  character: string;
  sliding: boolean;
  ref: (cell: Cell | null) => void;
}) {
  const column = useRef<HTMLSpanElement | null>(null);
  const text = useRef<HTMLSpanElement | null>(null);
  const settle = useRef(0);

  useEffect(() => {
    ref({
      set: (next) => {
        const element = column.current;
        if (!element) {
          if (text.current) text.current.textContent = next;
          return;
        }

        const digit = Number(next);
        if (Number.isNaN(digit)) return;

        element.style.transform = `translateY(-${String(digit)}em)`;

        // The blur is the motion, and it is on for the length of the move only.
        // Left on, it is a permanently soft digit; done with a transition on
        // the filter, it is a second animation to keep in step with the first.
        element.style.filter = "blur(0.7px)";
        window.clearTimeout(settle.current);
        settle.current = window.setTimeout(() => {
          element.style.filter = "";
        }, SLIDE_MS);
      },
    });

    return () => {
      window.clearTimeout(settle.current);
      ref(null);
    };
  }, [ref]);

  if (!sliding || !/\d/.test(character)) {
    return (
      <span ref={text} aria-hidden>
        {character}
      </span>
    );
  }

  return (
    // `overflow-hidden` on a box exactly one line tall is the window the wheel
    // turns behind. `align-bottom` because an inline-block sits on the text
    // baseline by default, which would drop the whole readout by its descender.
    <span
      className="relative inline-block h-[1em] overflow-hidden align-bottom"
      style={{ width: "1ch" }}
      aria-hidden
    >
      <span
        ref={column}
        className="flex flex-col"
        style={{
          transform: `translateY(-${character}em)`,
          transition: `transform ${String(SLIDE_MS)}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
          willChange: "transform",
        }}
      >
        {DIGITS.map((digit) => (
          <span key={digit} className="h-[1em] leading-[1em]">
            {digit}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * How long a digit takes to travel.
 *
 * Under a fifth of a second: long enough to be seen as a move rather than a
 * swap, short enough that the seconds digit has always arrived before the next
 * one is due.
 */
const SLIDE_MS = 180;

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
