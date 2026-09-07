/**
 * The faces captions can be set in.
 *
 * Curated rather than enumerated. The Local Font Access API would hand over
 * every font on the machine, but most of a font book is unusable at caption
 * size, and a project set in something the next Mac does not have renders in a
 * fallback face with nothing to say so — a recording that looks wrong on the
 * machine it is shared with is worse than a short list.
 *
 * Every entry here ships with macOS. `available` is what stops that being an
 * assumption: a family the engine cannot resolve is not an error, it is
 * silently the next thing in the stack — see `FALLBACK`.
 */
export interface CaptionFont {
  /** Stored in the project. Stable: renaming a label must not restyle a save. */
  id: string;
  label: string;
  /** What reaches `ctx.font`, fallbacks and all. */
  stack: string;
}

/**
 * What every stack ends in, and what an unresolved family lands on.
 *
 * Also the yardstick `available` measures against: a name the engine cannot
 * find measures exactly as this does, because this is what it fell through to.
 */
const FALLBACK = "Arial, sans-serif";

export const CAPTION_FONTS: CaptionFont[] = [
  // `system-ui` and nothing else is a handle on SF. macOS ships it only as the
  // dot-prefixed internal `.SF NS` family, so `"SF Pro Display"` resolves to
  // nothing and `-apple-system` is not a name Canvas 2D knows at all — the note
  // at the top of `captionBitmap.ts` has the measurements.
  { id: "system", label: "System", stack: `system-ui, ${FALLBACK}` },
  { id: "helvetica", label: "Helvetica Neue", stack: `"Helvetica Neue", ${FALLBACK}` },
  { id: "avenir", label: "Avenir Next", stack: `"Avenir Next", ${FALLBACK}` },
  { id: "futura", label: "Futura", stack: `Futura, ${FALLBACK}` },
  { id: "optima", label: "Optima", stack: `Optima, ${FALLBACK}` },
  { id: "georgia", label: "Georgia", stack: `Georgia, serif` },
  { id: "times", label: "Times", stack: `"Times New Roman", Times, serif` },
  { id: "courier", label: "Courier", stack: `"Courier New", Courier, monospace` },
  { id: "menlo", label: "Menlo", stack: `Menlo, monospace` },
];

/** The one anything unrecognised falls back to. Named, so it cannot be missing. */
export const DEFAULT_FONT = CAPTION_FONTS[0]!;

export function captionFont(id: string): CaptionFont {
  return CAPTION_FONTS.find((font) => font.id === id) ?? DEFAULT_FONT;
}

/**
 * Whether the engine can actually resolve a family.
 *
 * Canvas gives no answer to "did you find that font?" — an unknown name is not
 * an error, it simply falls through the stack. So the question is asked by
 * measuring: set a string in the family alone, set it again in a name nothing
 * can match, and compare. Identical widths mean the first one was not found
 * either, because both ended up in the same place.
 *
 * A pangram-ish sample rather than one word: two faces can agree on the width
 * of "Handgloves" and differ everywhere else, and a false positive here means
 * a font offered in the picker that quietly is not the one drawn.
 */
const PROBE = "Handgloves 123 WAVE quick fox";
const NOTHING = "__prequel_no_such_family__";

export function available(family: string, measure: (font: string) => number): boolean {
  const bogus = measure(`64px ${NOTHING}`);
  // Measured against the bare family, not the stack: a stack ends in Arial, so
  // asking about the whole thing would answer "yes" for every entry.
  return measure(`64px ${family}, ${NOTHING}`) !== bogus;
}

/** The bare family a stack leads with, which is the one being asked about. */
export function leadFamily(stack: string): string {
  return stack.split(",")[0]!.trim();
}

export { PROBE };
