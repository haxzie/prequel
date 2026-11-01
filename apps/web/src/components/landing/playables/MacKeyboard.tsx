/**
 * A keyboard in the dark, lit only where it is being typed on.
 *
 * A grid of squares with letters in it first, then a silver Magic Keyboard in
 * perspective — a convincing object, and the brightest thing on a dark page.
 * This one is neither: the full board, flat, drawn larger than the card and
 * running off both edges, so it has no frame and no visible end.
 *
 * Nothing here is an image. The fade is a mask, the glow is a shadow, and
 * every fill is a token — so the board is sharp at any width, costs nothing to
 * load, and follows the theme it is dropped into.
 *
 * The gaps are 3px and not a percentage. A percentage gap resolves against the
 * container's size in that axis, so the same `0.9%` was seven pixels between
 * the caps in a row and something else entirely between the rows — the board
 * came out gridded horizontally and crushed vertically. A keyboard's gaps are
 * one gap, so they are one number.
 *
 * The whole board and not the three rows the phrase needs. A keyboard cropped
 * to QWERTY-ASDF-ZXCV is a diagram of the keys in use; the number row and the
 * bracket keys are what make it one.
 */

/** One cap: the legend, the symbol a Mac prints above it, and its width. */
type Cap = { key: string; sym?: string; w?: number };

const ROWS: Cap[][] = [
  [
    { key: "`", sym: "~" },
    { key: "1", sym: "!" },
    { key: "2", sym: "@" },
    { key: "3", sym: "#" },
    { key: "4", sym: "$" },
    { key: "5", sym: "%" },
    { key: "6", sym: "^" },
    { key: "7", sym: "&" },
    { key: "8", sym: "*" },
    { key: "9", sym: "(" },
    { key: "0", sym: ")" },
    { key: "-", sym: "_" },
    { key: "=", sym: "+" },
    { key: "delete", w: 1.5 },
  ],
  [
    { key: "tab", w: 1.5 },
    { key: "Q" },
    { key: "W" },
    { key: "E" },
    { key: "R" },
    { key: "T" },
    { key: "Y" },
    { key: "U" },
    { key: "I" },
    { key: "O" },
    { key: "P" },
    { key: "[", sym: "{" },
    { key: "]", sym: "}" },
    { key: "\\", sym: "|", w: 1.5 },
  ],
  [
    { key: "caps lock", w: 1.8 },
    { key: "A" },
    { key: "S" },
    { key: "D" },
    { key: "F" },
    { key: "G" },
    { key: "H" },
    { key: "J" },
    { key: "K" },
    { key: "L" },
    { key: ";", sym: ":" },
    { key: "'", sym: '"' },
    { key: "return", w: 1.9 },
  ],
  [
    { key: "shift", w: 2.3 },
    { key: "Z" },
    { key: "X" },
    { key: "C" },
    { key: "V" },
    { key: "B" },
    { key: "N" },
    { key: "M" },
    { key: ",", sym: "<" },
    { key: ".", sym: ">" },
    { key: "/", sym: "?" },
    { key: "shift", w: 2.4 },
  ],
  [
    { key: "fn" },
    { key: "control", sym: "^" },
    { key: "option", sym: "⌥" },
    { key: "command", sym: "⌘", w: 1.25 },
    { key: "", w: 5 },
    { key: "command", sym: "⌘", w: 1.25 },
    { key: "option", sym: "⌥" },
  ],
];

/**
 * Where the phrase lands, as `[row, index]` into `ROWS`.
 *
 * "the quick brown fox", then Return — the clip's own phrase, spelled out so
 * the keys light in the order they are actually struck. A sweep left to right
 * would be a loading bar; typing crosses the board.
 */
const STRIKE_ORDER: [number, number][] = [
  [1, 5], // t
  [2, 6], // h
  [1, 3], // e
  [4, 4], // space
  [1, 1], // q
  [1, 7], // u
  [1, 8], // i
  [3, 3], // c
  [2, 8], // k
  [3, 5], // b
  [1, 4], // r
  [1, 9], // o
  [1, 2], // w
  [3, 6], // n
  [2, 4], // f
  [3, 2], // x
  [2, 12], // return
];

/** The caps whose legend a Mac sets in the corner rather than centred. */
const CORNERED = new Set(["tab", "caps lock", "shift", "control", "option", "command", "fn"]);
const RIGHT_ALIGNED = new Set(["return", "delete"]);

export function MacKeyboard({ playing }: { playing: boolean }) {
  return (
    // Wider than the card, so the board runs off both edges. A keyboard that
    // fits inside its box has two ends and reads as a picture of one; this one
    // carries on past the card.
    //
    // Centred by the stage's own `justify-items-center` rather than by a
    // transform here. It was `place-items-end` and a counter-translate, which
    // is two ways of saying the same thing and they disagreed: `end` is
    // *right*, so the board was pinned to the right edge and then shifted, and
    // the whole left half of it was off the card.
    <div className="w-[148%]">
      {/* No fade and no vignette. There was a mask here — an ellipse anchored
          at the bottom centre, so the board dissolved towards the top and the
          sides — and it is gone because every key should read the same as
          every other. The board still has no frame and still runs off both
          edges; it is simply all there. */}
      <div className="flex flex-col gap-[3px]">
        {ROWS.map((row, r) => (
          <div key={r} className="flex gap-[3px]">
            {row.map((cap, i) => {
              const strike = STRIKE_ORDER.findIndex(([sr, si]) => sr === r && si === i);
              return (
                <span
                  key={`${cap.key}-${i}`}
                  style={{
                    // A zero basis so a 1.5-unit key is exactly half again as
                    // wide as a letter at every card width. A percentage width
                    // would have to know about the gaps.
                    flexGrow: cap.w ?? 1,
                    flexBasis: 0,
                    // Carried whether or not anything is playing, so a key
                    // that starts animating does not also change its delay
                    // mid-flight.
                    animationDelay: strike >= 0 ? `${strike * 150}ms` : undefined,
                  }}
                  className={`relative grid h-7 place-items-center rounded-[7px] text-[10px] leading-none font-medium sm:h-9 sm:text-[11px] ${
                    playing && strike >= 0 ? "animate-key-press" : ""
                  }`}
                  // The cap's fill and its struck state are in `globals.css` —
                  // both are tokens, so the board follows whatever theme it is
                  // dropped into rather than carrying its own.
                  data-cap
                >
                  {/* The symbol a Mac prints above the legend, in the corner
                      and dimmer. It is most of what a keyboard looks like
                      close up, and all of it is under the fade. */}
                  {cap.sym && !CORNERED.has(cap.key) ? (
                    <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] opacity-45">
                      {cap.sym}
                    </span>
                  ) : null}
                  {cap.sym && CORNERED.has(cap.key) ? (
                    <span className="absolute top-1 right-1.5 text-[8px] opacity-45">
                      {cap.sym}
                    </span>
                  ) : null}

                  {CORNERED.has(cap.key) ? (
                    <span className="w-full px-1.5 text-left text-[8px] tracking-tight">
                      {cap.key}
                    </span>
                  ) : RIGHT_ALIGNED.has(cap.key) ? (
                    <span className="w-full px-1.5 text-right text-[8px] tracking-tight">
                      {cap.key}
                    </span>
                  ) : (
                    // Pushed down when the cap carries a symbol above it, the
                    // way a real legend sits in the lower half of the cap.
                    <span className={cap.sym ? "translate-y-[0.3em]" : undefined}>{cap.key}</span>
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
