/**
 * The shortcuts a recording saw, as they are shown on the video.
 *
 * A chord is a row of key caps — ⇧ ⌘ P — drawn where the recording was made
 * rather than where the pointer is, and held for a moment after the press. The
 * editor turns each one into a bitmap and `layout.ts` places it; this is the
 * table both are interpreted through, and the arithmetic that has to agree
 * between them.
 *
 * Deliberately free of any DOM, Node or React import: the panel builds its
 * picker from this, the rasteriser draws from it, `layout.ts` places from it,
 * and all three have to work in a test with none of them.
 *
 * ## What a recording keeps
 *
 * Only chords, and only the caps. `shortcut` in
 * `crates/prequel-capture/src/clicks.rs` is the whole of the rule and refuses
 * every press somebody made while typing — so there is nothing here to show
 * that anybody typed, and nothing downstream that could.
 */

/** How a chord's caps are dressed. */
export type KeyPlate = "keys" | "bar" | "outline" | "plain";

export interface KeyPlateSpec {
  label: string;
  /** A line for the picker. What it looks like, not what it does. */
  hint: string;
}

export const KEY_PLATES: Record<KeyPlate, KeyPlateSpec> = {
  keys: { label: "Keys", hint: "Each cap on a dark key of its own." },
  bar: { label: "Bar", hint: "The whole chord on one dark plate." },
  outline: { label: "Outline", hint: "Caps drawn as hollow keys." },
  plain: { label: "Plain", hint: "The letters alone, on nothing." },
};

export const KEY_PLATE_IDS = Object.keys(KEY_PLATES) as KeyPlate[];

/** Which edge of the frame the chords sit against. */
export type KeyPosition = "top" | "bottom";

/**
 * The plate a name picks, falling back rather than throwing.
 *
 * The same guard `captionFont` and `cursorStyle` have, for the same reason: a
 * project written by a build with a plate this one does not ship still opens,
 * and opens drawing something.
 */
export function keyPlate(name: string): KeyPlate {
  return (KEY_PLATE_IDS as string[]).includes(name) ? (name as KeyPlate) : "keys";
}

/**
 * How long a chord stays on screen after it was pressed, in nanoseconds.
 *
 * Long enough to read a three-cap chord without pausing, short enough that two
 * shortcuts a second apart do not stack. Not a setting: a chord that outstayed
 * the next one would have to be dealt with by some rule nobody asked for, and
 * the one case this is wrong for — a shortcut held up for a screenshot — is
 * better served by the clip being slowed down.
 */
export const KEY_HOLD_NS = 1_400_000_000;

/** How long a chord takes to arrive, and to leave. */
export const KEY_FADE_NS = 140_000_000;

/**
 * Two chords closer together than this are drawn as one row.
 *
 * ⌘C then ⌘V half a second apart is one gesture to whoever is watching, and
 * two overlapping plates in the same place is unreadable. The later chord
 * replaces the earlier one: what is on screen is always the last thing
 * pressed, which is what a viewer is looking for.
 */
export const KEY_COALESCE_NS = 220_000_000;

/**
 * How far off the frame's edge the row sits, as a fraction of the shorter
 * edge.
 *
 * Measured against the shorter edge like every other geometry leaf, so the
 * margin survives 16:9 → 9:16.
 */
export const KEY_MARGIN = 0.05;

/**
 * The size leaf, as a fraction of the frame's shorter edge, and what it means.
 *
 * It is the **cap height** — the side of one square key — rather than the
 * row's height or the font's size, because that is the thing somebody is
 * judging when they drag the slider. The font is a fraction of it, and the row
 * is as wide as the chord happens to be.
 */
export const KEY_SIZE_MIN = 0.02;
export const KEY_SIZE_MAX = 0.12;

/**
 * The size leaf as the slider shows it, and back.
 *
 * The leaf is a fraction of the frame's shorter edge, because every geometry
 * leaf is — that is what lets a look survive 16:9 becoming 9:16. But those
 * fractions are small: the whole useful range of a key cap is two to twelve
 * per cent, so a slider showing the leaf reads "5%" and spends nine tenths of
 * its travel on sizes nobody wants.
 *
 * So the control runs 0 to 100% of *the range* instead, which is the question
 * being asked — how big, between as small as this is worth drawing and as
 * large as it is worth drawing. Converted here rather than at the panel, so
 * the two directions cannot drift apart.
 */
export function keySizeSlider(size: number): number {
  return (size - KEY_SIZE_MIN) / (KEY_SIZE_MAX - KEY_SIZE_MIN);
}

export function keySizeLeaf(slider: number): number {
  return KEY_SIZE_MIN + slider * (KEY_SIZE_MAX - KEY_SIZE_MIN);
}

/** Proportions of one cap, as multiples of the cap's height. */
export const KEY_GLYPH = 0.52;
/** A cap is at least square, and wider where the legend needs it. */
export const KEY_PAD_X = 0.3;
/** The gap between two caps. */
export const KEY_GAP = 0.14;
/** The corner radius of a cap, and of the bar. */
export const KEY_RADIUS = 0.22;
/**
 * Room around the row for everything drawn outside the caps.
 *
 * The shadow reaches furthest, and a bitmap cut to the caps would shave it —
 * the same reason a text unit's cell is padded. A fraction of the cap height,
 * so it scales with everything else.
 */
export const KEY_BLEED = 0.45;

/**
 * The size of the bitmap one chord is drawn into, in its own pixels.
 *
 * Laid out here rather than in the rasteriser because `layout.ts` has to place
 * the result and the two must agree exactly: the plan says where a bitmap
 * lands, and a bitmap of a different shape lands stretched. The measuring of
 * the *legends* is the one thing this cannot do without a canvas, so a cap is
 * sized by its character count instead — which is exact, because every legend
 * is one glyph but for `Space` and the function keys.
 */
export function chordExtent(
  keys: readonly string[],
  cap: number,
): { width: number; height: number } {
  const caps = keys.map((key) => capWidth(key, cap));
  const gaps = Math.max(keys.length - 1, 0) * KEY_GAP * cap;
  const bleed = KEY_BLEED * cap * 2;
  return {
    width: caps.reduce((total, width) => total + width, 0) + gaps + bleed,
    height: cap + bleed,
  };
}

/**
 * How wide one cap is drawn, in the same pixels.
 *
 * Square for a single glyph, which is every modifier and every letter, and
 * wider for the handful of legends that are a word — `Space`, `F12`. Measured
 * from the character count rather than from the face, so this agrees with the
 * rasteriser without a canvas: the padding is generous enough to hold any face
 * the picker offers at this size.
 */
export function capWidth(key: string, cap: number): number {
  const glyphs = [...key].length;
  if (glyphs <= 1) return cap;
  return cap * (KEY_PAD_X * 2 + KEY_GLYPH * 0.62 * glyphs);
}

/**
 * A name for everything about a chord's *pixels*, from one clip's settings.
 *
 * The row is a per-clip setting, so two clips can ask for two looks — and the
 * bitmaps are shared, so the plan has to be able to say which of them a clip
 * draws. This is that name: the editor rasterises one chord per style in use
 * and tags it with this, and `layout.ts` picks the tag matching the clip it is
 * building.
 *
 * Deliberately **not** the size or the position: those move pixels rather than
 * redrawing them, and a size slider that renamed every bitmap on the way past
 * would rewrite the whole set sixty times a second.
 *
 * No face either, because there is only one: a shortcut is a keyboard legend,
 * and a keyboard legend is the system face — see `KEY_FONT`.
 */
export function keyStyleId(layout: {
  keysPlate: string;
  keysColor: string;
  keysOpacity: number;
}): string {
  return [keyPlate(layout.keysPlate), layout.keysColor, layout.keysOpacity.toFixed(3)].join("|");
}

/**
 * The face the caps are drawn in, by family id.
 *
 * Fixed rather than a setting. A key cap is a picture of a key, and every key
 * anybody is looking at while they watch the video is lettered in the system
 * face — a chord set in a display serif is a quotation of a keyboard rather
 * than a keyboard. The control that offered the choice was one more thing to
 * get wrong for no look anybody wanted.
 */
export const KEY_FONT = "system";

/** The leaves a chord's pixels depend on, from one clip's settings. */
export interface KeyLook {
  keysVisible: boolean;
  keysPlate: string;
  keysColor: string;
  keysOpacity: number;
}

/**
 * Every look a project actually asks for, by `keyStyleId`.
 *
 * The scopes are the defaults and each clip's settings *resolved over them* —
 * not the raw overrides, because a clip that switches the row on and styles
 * nothing is asking for the defaults' look and must share their bitmaps.
 *
 * Reading only the defaults is how this shipped broken: the row is a per-clip
 * setting, and the way anybody turns it on is to select a clip and switch it
 * there. The defaults then say `keysVisible: false`, nothing is drawn, and the
 * panel shows a row of controls over a video with no shortcuts on it.
 */
export function keyLooks<T extends KeyLook>(scopes: Iterable<T>): Map<string, T> {
  const looks = new Map<string, T>();
  for (const scope of scopes) {
    if (!scope.keysVisible) continue;
    const id = keyStyleId(scope);
    if (!looks.has(id)) looks.set(id, scope);
  }
  return looks;
}
