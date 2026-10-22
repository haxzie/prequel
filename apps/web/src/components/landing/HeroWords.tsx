/**
 * The three decorated words in the home page's headline.
 *
 * The sentence is still written out in `page.tsx`; these are only how three of
 * its words are drawn. Each one quotes a piece of the app rather than being
 * decoration for its own sake — a selected object, a clip on the timeline, the
 * Finder face — so the headline shows what the product is before the picture
 * below it starts playing.
 *
 * Everything is sized in `em`. The heading runs from 2rem to 6rem across the
 * breakpoints and these have to hold their proportions the whole way; a chip
 * with 6px of padding is a lozenge at 32px and a hairline at 96px.
 *
 * The two boxes are tilted, and in opposite directions: pinned the same way
 * they read as a page printed crooked rather than as two things dropped onto
 * it. Two degrees and one and a half, which is about as far as this can go —
 * the tilt lifts a corner by half the box's width times its sine, so at the
 * 6rem setting three degrees would put a corner into the line above. A
 * transform is not laid out, so none of this moves the sentence.
 *
 * All three carry `data-hero-chip`, which is what the heading's `has-`
 * variant looks for to relax its leading. See the note in `Hero.tsx`. The two
 * that draw a box then set `leading-[1]` back on themselves: they are
 * inline-flex, so the heading's relaxed line-height would otherwise be baked
 * into the box as well and each chip would stand a third of a line taller than
 * the word inside it.
 */
/**
 * The word, selected.
 *
 * Nothing filled: the word in the heading's own ink, with a line of the accent
 * around it and the eight handles a selected object wears in the editor, four
 * on the corners and four on the edges. Empty rather than filled: a solid accent
 * field with the word knocked out in white reads as a button above the fold,
 * and the only button up there should be the one that downloads the app.
 * `--accent` is the playhead in the icon and in the editor, so the selection
 * is the same blue as the thing that moves.

 *
 * `items-baseline` so the emoji sits on the same line as the word instead of
 * centring itself against a taller box.
 *
 * The border is in `em` like everything else here, and deliberately heavier
 * than a hairline: at the 6rem setting a 1px line beside a 96px word is a
 * thread, and the box stops reading as a selection at all.
 *
 * The handles are drawn as absolute children centred on the border rather than
 * laid out in flow, so they add nothing to the box and the word stays where
 * the sentence puts it. The padding is what keeps the letters off them.
 */
export function HeroCard({ children }: { children: string }) {
  return (
    <span
      data-hero-chip
      className="relative inline-flex -rotate-2 items-baseline gap-[0.16em] rounded-[0.1em] border-[0.055em] border-accent px-[0.26em] py-[0.02em] leading-[1] whitespace-nowrap"
    >
      {/* Aria-hidden so the heading is still read as its sentence. The glyph is
          drawn by the platform's own emoji font, which has no weight to match,
          so it is nudged a touch smaller than the word beside it. */}
      <span aria-hidden="true" className="text-[0.78em]">
        🎬
      </span>
      {children}
      {HANDLES.map((at) => (
        <span
          key={at}
          aria-hidden="true"
          className={`absolute size-[0.22em] rounded-[0.05em] border-[0.045em] border-accent bg-bg ${at}`}
        />
      ))}
    </span>
  );
}

/** Where the eight handles sit, each one centred on the border it is on, so
    half of it is inside the box and half outside. Filled with the page's own
    background rather than white: the border has to pass behind a handle and
    not through it, and the hero is not drawn on white everywhere it is used. */
const HANDLES = [
  "top-0 left-0 -translate-x-1/2 -translate-y-1/2",
  "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
  "top-0 right-0 translate-x-1/2 -translate-y-1/2",
  "top-1/2 right-0 translate-x-1/2 -translate-y-1/2",
  "bottom-0 right-0 translate-x-1/2 translate-y-1/2",
  "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
  "bottom-0 left-0 -translate-x-1/2 translate-y-1/2",
  "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2",
];

/**
 * A clip on the timeline, with the two grips that say its ends can be dragged.
 *
 * `--lilac`, which on the light site is a rich purple rather than the pale
 * handle colour it is in the artwork — it has to be, because it also sets inline
 * `code` in the prose. Filled, and the one filled field above the fold: the
 * word inside is white, and a tint of iris on paper leaves it at about two to
 * one. White on this holds 7:1. The demo timeline further down the page is
 * deliberately not this colour — its slices are the accent, because there they
 * are lit by a playhead crossing them and the accent is what the playhead is.
 *
 * The grips are white rather than the icon's lilac, which is now the field
 * itself: the same colour twice over is a clip with no visible ends.
 *
 * They are absolute rather than flex children so the word stays centred in the
 * clip: laid out in flow they would push it right by their own width. The
 * horizontal padding is what keeps the text off them.
 */
export function HeroClip({ children }: { children: string }) {
  return (
    <span
      data-hero-chip
      className="relative inline-flex rotate-[1.5deg] items-baseline rounded-[0.32em] border border-lilac bg-lilac px-[0.58em] pt-[0.07em] pb-[0.13em] leading-[1] whitespace-nowrap text-white"
    >
      <Grip edge="start" />
      {children}
      <Grip edge="end" />
    </span>
  );
}

/** One end of the clip. Rounded on its outer side only, so the pair reads as
    caps on the clip rather than as two pills sitting inside it. */
function Grip({ edge }: { edge: "start" | "end" }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-y-0 grid w-[0.34em] place-items-center bg-white/25 ${
        edge === "start" ? "left-0 rounded-l-[0.3em]" : "right-0 rounded-r-[0.3em]"
      }`}
    >
      <span className="h-1/2 w-[0.06em] rounded-full bg-white" />
    </span>
  );
}

/**
 * The platform, with the Finder face beside it.
 *
 * The face rather than the Apple mark: Apple's guidelines keep their logo
 * beside a word and never decorated, and a tilted Apple logo is exactly what
 * they rule out. The Finder icon is the Mac itself to anyone who has used one,
 * and it takes the same tilt the chips do without quoting a rule.
 *
 * Tilted the other way from the clip before it, for the reason the two boxes
 * are: three things leaning the same way read as a crooked page. Four degrees,
 * more than either box, because a square this small can lean further before
 * a corner reaches the line above.
 *
 * A plain `<img>` and not `next/image`: it is 320px square and sized in `em`
 * against the heading, and the optimiser would hand back a `srcset` sized for
 * a layout width this element does not have.
 */
export function HeroPlatform({ children }: { children: string }) {
  return (
    <span data-hero-chip className="inline-flex items-baseline gap-[0.18em] whitespace-nowrap">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/finder.png"
        alt=""
        aria-hidden="true"
        className="size-[0.88em] translate-y-[0.1em] rotate-[4deg] select-none"
      />
      {children}
    </span>
  );
}
