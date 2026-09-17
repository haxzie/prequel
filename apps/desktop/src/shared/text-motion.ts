/**
 * How a text overlay arrives and leaves.
 *
 * Pure arithmetic over a resting rectangle: given where a unit of text sits
 * when it is simply on screen, this says where it is — and how see-through
 * and how soft — at every moment of its entrance and exit, as the sampled keys
 * the plan carries. Nothing here knows about fonts or bitmaps; `layout.ts`
 * works out the resting rectangle and hands it in.
 *
 * Sampled rather than described, for the reason zooms are: the exporter lerps
 * between keys and decides nothing, so an easing that exists only here cannot
 * come out differently in the file than it did in the preview.
 */
import type { OverlayKey, Rect } from "./layout.js";

export type TextMotionId =
  | "none"
  | "fade"
  | "rise"
  | "drop"
  | "fromLeft"
  | "fromRight"
  | "pop"
  | "blur"
  | "typewriter"
  | "words";

export const TEXT_MOTIONS: { id: TextMotionId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade" },
  { id: "rise", label: "Rise" },
  { id: "drop", label: "Drop" },
  { id: "fromLeft", label: "From left" },
  { id: "fromRight", label: "From right" },
  { id: "pop", label: "Pop" },
  { id: "blur", label: "Blur" },
  { id: "typewriter", label: "Typewriter" },
  { id: "words", label: "Word by word" },
];

/** Narrows a stored value to a motion, defaulting to a plain fade. */
export function textMotion(value: unknown): TextMotionId {
  return TEXT_MOTIONS.some((motion) => motion.id === value) ? (value as TextMotionId) : "fade";
}

/**
 * What a motion moves one at a time.
 *
 * Only the two staggered motions split a field up. Everything else moves the
 * whole field as one picture — deliberately, because a field cut into
 * per-glyph cells and faded as one shows every seam between the cells at
 * half opacity, where a glyph's soft edge overlaps its neighbour's cell.
 */
export type TextUnitKind = "block" | "word" | "char";

export function unitKindFor(motion: TextMotionId): TextUnitKind {
  if (motion === "typewriter") return "char";
  if (motion === "words") return "word";
  return "block";
}

/** The finer of two unit kinds, so an enter and an exit share one cut. */
export function finerUnit(a: TextUnitKind, b: TextUnitKind): TextUnitKind {
  const rank: Record<TextUnitKind, number> = { block: 0, word: 1, char: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * The widest a motion ever blurs, as a fraction of the font size.
 *
 * The bitmap pads every cell by this much so a blurred glyph has room to
 * spread inside its own crop, and `textKeys` never asks for more. One number
 * in one place, or the rasteriser and the motion would each have their own
 * idea of how far a soft edge reaches.
 */
export const MAX_TEXT_BLUR = 0.35;

/** The timing of one overlay: which motions, and how long each takes. */
export interface TextTiming {
  enter: TextMotionId;
  exit: TextMotionId;
  /** Milliseconds, as the slider stores them. */
  enterMs: number;
  exitMs: number;
}

/** Which unit of a field is being animated, out of how many. */
export interface TextUnitIndex {
  index: number;
  count: number;
}

/**
 * How often a motion is sampled. The same rate a zoom is sampled at, for the
 * same reason: a straight line between two keys this close cannot be told
 * from the curve they were taken off.
 */
const SAMPLE_NS = 1_000_000_000 / 30;

/**
 * A step in the timeline's own units, for the two motions that switch rather
 * than move. One nanosecond apart is the smallest gap `withWholeTimes` keeps.
 */
const STEP_NS = 1;

/**
 * How the enter and exit windows are shared out to the units of a staggered
 * motion: each unit takes this fraction of the window for its own move, and
 * the rest of the window is spread between their starts.
 */
const UNIT_SHARE = 0.5;

/**
 * The keys one unit of text is drawn from, over the whole of its span.
 *
 * `rest` is where the unit sits when it is simply on screen, in output
 * pixels; `blur` is the widest it may be softened, in the bitmap's own
 * pixels, because that is what both rasterisers blur in.
 *
 * The enter and the exit are each clamped to half the span, here and nowhere
 * else, so a text trimmed shorter than its two motions still finishes arriving
 * before it starts leaving — and so every consumer of a key list agrees on
 * where the hold begins.
 */
export function textKeys(
  rest: Rect,
  unit: TextUnitIndex,
  timing: TextTiming,
  span: { start: number; end: number },
  blur: number,
): OverlayKey[] {
  const length = Math.max(0, span.end - span.start);
  const enter = Math.min(timing.enterMs * 1_000_000, length / 2);
  const exit = Math.min(timing.exitMs * 1_000_000, length / 2);

  const keys: OverlayKey[] = [];

  // The entrance, from the unit's own first instant to its last: staggered
  // motions give each unit a slice of the window, everything else gives every
  // unit the whole of it.
  const arriving = window(span.start, enter, unit, timing.enter);
  keys.push(...sampled(rest, timing.enter, arriving, blur, "in"));

  // The hold: a key at either end, so the exporter draws the unit at rest
  // between them rather than interpolating from the entrance into the exit.
  const leaving = window(span.end - exit, exit, unit, timing.exit);
  keys.push(key(arriving.to, rest, 1, 0), key(leaving.from, rest, 1, 0));

  keys.push(...sampled(rest, timing.exit, leaving, blur, "out"));

  // Sorted and deduplicated by time. A zero-length enter puts two keys on the
  // same nanosecond, and a later one in a list is what the lerp would land on
  // — so the later one wins, which is the one nearer the hold.
  const byTime = new Map<number, OverlayKey>();
  for (const entry of keys) byTime.set(entry.at, entry);
  return [...byTime.values()].sort((a, b) => a.at - b.at);
}

/** The stretch of time one unit's motion runs over. */
function window(
  from: number,
  length: number,
  unit: TextUnitIndex,
  motion: TextMotionId,
): { from: number; to: number } {
  if (unitKindFor(motion) === "block" || unit.count <= 1) return { from, to: from + length };

  // Each unit moves for a share of the window and the starts are spread over
  // what is left, so the last unit finishes exactly where the window ends.
  const own = length * UNIT_SHARE;
  const spread = length - own;
  const offset = (spread * unit.index) / Math.max(1, unit.count - 1);
  return { from: from + offset, to: from + offset + own };
}

/** The keys across one window, in or out. */
function sampled(
  rest: Rect,
  motion: TextMotionId,
  over: { from: number; to: number },
  blur: number,
  direction: "in" | "out",
): OverlayKey[] {
  const length = over.to - over.from;
  if (motion === "none" || length <= 0) return [];

  // Two keys a nanosecond apart, not a ramp: the typewriter switches a glyph
  // on. Sampling it would draw every glyph half-there for a frame.
  if (motion === "typewriter") {
    return direction === "in"
      ? [key(over.from, rest, 0, 0), key(over.from + STEP_NS, rest, 1, 0)]
      : [key(over.to - STEP_NS, rest, 1, 0), key(over.to, rest, 0, 0)];
  }

  const steps = Math.max(2, Math.ceil(length / SAMPLE_NS));
  const keys: OverlayKey[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    // Eased out on the way in and in on the way out, so a text settles into
    // place and leaves with a push rather than the reverse.
    const eased = direction === "in" ? 1 - (1 - t) ** 3 : 1 - t ** 3;
    const at = over.from + length * t;
    keys.push(posed(at, rest, motion, eased, blur));
  }
  return keys;
}

/**
 * Where a unit is at a given progress: 0 is fully hidden, 1 is at rest.
 *
 * Travel is measured in the unit's own height rather than in pixels or a
 * fraction of the frame, so a small caption and a large title each move by
 * about a line — the same gesture at every size.
 */
function posed(at: number, rest: Rect, motion: TextMotionId, p: number, blur: number): OverlayKey {
  const travel = rest.height;
  const hidden = 1 - p;

  switch (motion) {
    case "rise":
      return key(at, { ...rest, y: rest.y + travel * 0.6 * hidden }, p, 0);
    case "drop":
      return key(at, { ...rest, y: rest.y - travel * 0.6 * hidden }, p, 0);
    case "fromLeft":
      return key(at, { ...rest, x: rest.x - travel * hidden }, p, 0);
    case "fromRight":
      return key(at, { ...rest, x: rest.x + travel * hidden }, p, 0);
    case "pop": {
      // Grown about its own centre, so it swells in place.
      const scale = 0.6 + 0.4 * p;
      const width = rest.width * scale;
      const height = rest.height * scale;
      return key(
        at,
        {
          x: rest.x - (width - rest.width) / 2,
          y: rest.y - (height - rest.height) / 2,
          width,
          height,
        },
        p,
        0,
      );
    }
    case "blur":
      return key(at, rest, p, blur * hidden);
    case "words":
      return key(at, { ...rest, y: rest.y + travel * 0.4 * hidden }, p, 0);
    default:
      return key(at, rest, p, 0);
  }
}

function key(at: number, rect: Rect, opacity: number, blur: number): OverlayKey {
  return {
    at,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    opacity: Math.min(1, Math.max(0, opacity)),
    blur: Math.max(0, blur),
  };
}
