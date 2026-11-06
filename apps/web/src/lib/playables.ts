/**
 * The two catalogues the "Try them" cards play.
 *
 * Written out here rather than imported from `apps/desktop`: `apps/web` shares
 * no code with the product, and a marketing page is exactly the second reason
 * to change `shared/` that the rule exists to prevent. The same arrangement as
 * the editor palette copied into `globals.css` — a copy free to drift, kept
 * where the drift is visible.
 *
 * What the copy must not drift on is the counts. Each list below says how many
 * the app ships and the cards print that number, so a style added to the app
 * and not to this file is a page that undersells it. The source of each count
 * is named on the list.
 */

/**
 * The pointers the card offers: the five teacher's sticks, then the five name
 * tags.
 *
 * Ten of the app's twenty-five, and ten that are not a pointer somebody
 * already has. A Mac's own arrow in black or white is the thing being replaced
 * rather than a reason to replace it, and the props — a frog, a corn, a
 * football — are a joke that lands once and then has to be scrolled past.
 * These two sets are the two reasons anybody changes this setting: pointing at
 * something in a lesson, and looking like a cursor in a shared canvas.
 *
 * The sticks are listed by their swatch. The sprite itself is 2048px of hand
 * and rod — the rod has to be able to leave the frame from anywhere inside it
 * — so a tile cut from the whole thing is a hairline across an empty square,
 * and the app's own picker shows the same crop for the same reason.
 *
 * `tag` is the colour the app writes the name in, taken from `CURSOR_STYLES`.
 * The art is only the arrow; the pill beside it is drawn at the size the
 * pointer is being drawn at, which is why it is a colour here and not a file.
 */
/**
 * A pointer, discriminated on `kind`.
 *
 * Declared rather than inferred from the list with `as const`: a tag carries a
 * colour and a stick does not, and an inferred tuple makes every entry its own
 * literal type — so the picked one cannot be held in a `useState` without
 * widening it back by hand.
 */
export type PointerStyle = { art: string; label: string } &
  /**
   * A stick carries two files. `art` is the swatch the tile shows — the crop
   * the app's own picker uses — and `stage` is the whole sprite: a hand on a
   * rod that runs off the bottom corner of its own square, which is what the
   * card needs, because the rod has to leave the frame rather than end inside
   * it. Cut to 640px here; the app ships 2048 so the rod can cross a 4K frame.
   */
  (
    | { kind: "stick"; stage: string; tag?: undefined }
    | { kind: "tag"; stage?: undefined; tag: string }
  );

/**
 * The one the card opens on, named rather than reached as `POINTERS[0]`.
 *
 * The same reason `captions.ts` names its own fallback: an index into a list
 * is a claim about the list's order, and this file's order is the app's rather
 * than this card's to choose.
 */
export const DEFAULT_POINTER: PointerStyle = {
  art: "stick-swatch",
  stage: "stick",
  label: "White pointer",
  kind: "stick",
};

export const POINTERS: PointerStyle[] = [
  DEFAULT_POINTER,
  { art: "stick-black-swatch", stage: "stick-black", label: "Black pointer", kind: "stick" },
  { art: "stick-wood-swatch", stage: "stick-wood", label: "Wooden pointer", kind: "stick" },
  { art: "stick-pink-swatch", stage: "stick-pink", label: "Pink pointer", kind: "stick" },
  { art: "stick-blue-swatch", stage: "stick-blue", label: "Fuzzy pointer", kind: "stick" },
  { art: "tag-blue", label: "Blue name tag", kind: "tag", tag: "#0d99ff" },
  { art: "tag-purple", label: "Purple name tag", kind: "tag", tag: "#9747ff" },
  { art: "tag-pink", label: "Pink name tag", kind: "tag", tag: "#ff24bd" },
  { art: "tag-orange", label: "Orange name tag", kind: "tag", tag: "#ff7a00" },
  { art: "tag-green", label: "Green name tag", kind: "tag", tag: "#14ae5c" },
];

/** The name on the tag in the card. Ours, so it is nobody else's recording. */
export const TAG_NAME = "Prequel";

/** What the pointer card claims, which is the app's own total. */
export const POINTER_COUNT = 25;

/**
 * The keyboards, in `KeyProfile::ALL`'s order.
 *
 * The audio under `public/sounds` is the real thing and not an impression of
 * it: `crates/prequel-keysound` synthesises every voice, and these files are
 * its own audition — `cargo test -p prequel-keysound --test audition --
 * --ignored` — trimmed to the four seconds before the test's two trailing
 * clicks and encoded to AAC. Re-render them from there if a profile is tuned.
 *
 * The phrase is the audition's: "the quick brown fox", a mistake, two deletes
 * and Return, at a real typist's cadence. A rhythm is half of what tells two
 * keyboards apart, which a single keypress cannot show.
 */
export const KEYBOARDS = [
  { id: "linear", label: "Linear", note: "Smooth, no bump" },
  { id: "tactile", label: "Tactile", note: "A bump, no click" },
  { id: "clicky", label: "Clicky", note: "The loud one" },
  { id: "thock", label: "Thock", note: "Deep and padded" },
  { id: "phone", label: "Phone", note: "A soft tap" },
] as const;
