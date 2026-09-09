/**
 * The three decorated words in the home page's headline.
 *
 * The sentence is still written out in `page.tsx`; these are only how three of
 * its words are drawn. Each one quotes a piece of the app rather than being
 * decoration for its own sake — a title card, a clip on the timeline, the
 * platform mark — so the headline shows what the product is before the picture
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
import { AppleIcon } from "@/components/icons";

/**
 * The title card.
 *
 * The accent, solid, with the word knocked out of it in white — the one filled
 * field above the fold and the one word the sentence is really about. Solid
 * rather than a tint of it: a chip carrying white text has to hold the contrast
 * on its own, and on paper a 25% wash of anything cannot. `--accent` is the
 * playhead in the icon and in the editor, so the loudest thing in the headline
 * is the same blue as the thing that moves.
 *
 * `items-baseline` so the emoji sits on the same line as the word instead of
 * centring itself against a taller box.
 *
 * A pill, where the clip beside it is squared off to a small radius — the two
 * are quoting different things and should not read as one component in two
 * colours. The padding is wider than the clip's for the shape's sake: a full
 * round eats into the ends, and at the clip's 0.26em the first and last letters
 * sit in the curve.
 */
export function HeroCard({ children }: { children: string }) {
  return (
    <span
      data-hero-chip
      className="inline-flex -rotate-2 items-baseline gap-[0.16em] rounded-full bg-accent px-[0.4em] py-[0.09em] leading-[1] whitespace-nowrap text-white"
    >
      {/* Aria-hidden so the heading is still read as its sentence. The glyph is
          drawn by the platform's own emoji font, which has no weight to match,
          so it is nudged a touch smaller than the word beside it. */}
      <span aria-hidden="true" className="text-[0.78em]">
        🎬
      </span>
      {children}
    </span>
  );
}

/**
 * A clip on the timeline, with the two grips that say its ends can be dragged.
 *
 * `--lilac`, which on the light site is a rich purple rather than the pale
 * handle colour it is in the artwork — it has to be, because it also sets inline
 * `code` in the prose. Filled, for the reason the card beside it is: the word
 * inside is white, and a tint of iris on paper leaves it at about two to one.
 * White on this holds 7:1. The demo timeline further down the page is
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
      className="relative inline-flex rotate-[1.5deg] items-baseline rounded-[0.2em] border border-lilac bg-lilac px-[0.58em] pt-[0.07em] pb-[0.13em] leading-[1] whitespace-nowrap text-white"
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
        edge === "start" ? "left-0 rounded-l-[0.2em]" : "right-0 rounded-r-[0.2em]"
      }`}
    >
      <span className="h-1/2 w-[0.06em] rounded-full bg-white" />
    </span>
  );
}

/**
 * The platform, with the mark for it.
 *
 * The mark sits beside the word and never in place of it, which is the line
 * Apple's guidelines draw — the note on `AppleIcon` has the rest. Optically
 * centred by hand: a solid mark reads smaller than the letters beside it and
 * the leaf puts its centre below the geometric one.
 */
export function HeroPlatform({ children }: { children: string }) {
  return (
    <span data-hero-chip className="inline-flex items-baseline gap-[0.16em] whitespace-nowrap">
      <AppleIcon className="size-[0.82em] translate-y-[0.06em]" />
      {children}
    </span>
  );
}
