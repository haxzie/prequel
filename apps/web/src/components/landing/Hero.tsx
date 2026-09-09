import type { ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { Container, Eyebrow } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import { StarredBy } from "@/components/StarredBy";
import { SITE } from "@/lib/site";

type HeroProps = {
  /** A node and not a string: the home page draws three of its words as chips.
      Every other page passes a plain string, which is still one of these. */
  title: ReactNode;
  lede: string;
  /** Small caps line above the heading. The home page passes none. */
  eyebrow?: string;
};

/**
 * How far apart the hero's rows start, in milliseconds.
 *
 * Well under the animation's own length, so the rows overlap heavily rather
 * than arriving one finished at a time. A stagger longer than the tail of the
 * ease reads as four separate entrances; this reads as one wave.
 */
const STAGGER_MS = 110;

/** The mark's own size and corner, shared with the shapes beside it. */
const MARK_SIZE = 104;
const MARK_RADIUS = 0.42;

/** The clear space between one shape and the next. */
const ECHO_GAP = 22;

/**
 * How present each shape is, outwards from the mark.
 *
 * Written out rather than compounded from a single ratio. The three are not a
 * curve — the last one is meant to be nearly gone, which is a smaller step than
 * a constant falloff from the first two would give, and the sequence is short
 * enough that three numbers are clearer than the formula that would produce
 * them.
 *
 * Three a side rather than more. A fourth at this rate is under 5%, which on
 * white is a shape you cannot see and the browser still paints — and on a wide
 * monitor it is the one that survives the clip and reads as a smudge near the
 * edge of the screen.
 */
const ECHO_OPACITY = [0.5, 0.3, 0.1];

/**
 * The shapes flanking the mark: the icon's own outline in grey, repeated
 * outwards and fainter each time until it is gone.
 *
 * Absolute, so none of this is in the layout. The mark is centred by the column
 * it sits in and has to stay exactly where it is — three shapes a side added to
 * the flow would push it off centre by nothing at all on a wide screen and by
 * half a shape on a narrow one, which is a headline that moves as the window
 * resizes.
 *
 * The clip that stops these scrolling the page sideways is on the `<section>`
 * and not on the row they sit in. The row is inside the headline's `max-w-3xl`
 * column, and these are wider than that on purpose — clipping there cut the
 * outermost pair off at 768px on every screen, however wide. `overflow-x-clip`
 * rather than `hidden` so it does not become a scroll container, and on one axis
 * only, which the mark needs: its halo is a shadow spreading well past the row's
 * own height. Same composition the demo track uses.
 *
 * Each shape is two elements, and that is not decoration. `hero-rise` is
 * declared with `fill-mode: both`, so the keyframe's closing `opacity: 1` sticks
 * to whatever it animated and beats an inline opacity on the same element — with
 * both on one span the three arrived at full strength and never faded at all.
 * The outer span holds the fade and the inner one is animated, so the two
 * multiply instead of fighting.
 *
 * Each one arrives after the one inside it. The mark is the hero's first row, so
 * these step out from its own entrance rather than from the top of the sequence,
 * and the last of them lands before the headline underneath has finished.
 */
function Echoes() {
  // Outwards from the mark: the first sits a gap beyond its edge, and each one
  // after that a whole shape and a gap further out.
  const offsets = ECHO_OPACITY.map(
    (_, i) => MARK_SIZE / 2 + ECHO_GAP + i * (MARK_SIZE + ECHO_GAP),
  );

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {offsets.map((offset, i) =>
        (["left", "right"] as const).map((side) => (
          <span
            key={`${side}-${offset}`}
            className="absolute top-1/2 block -translate-y-1/2"
            style={{
              width: MARK_SIZE,
              height: MARK_SIZE,
              [side]: `calc(50% + ${offset}px)`,
              opacity: ECHO_OPACITY[i],
            }}
          >
            <span
              data-hero-enter
              // Filled with the page's own panel grey and edged with the site's
              // hairline, which is the same pair every card further down the page
              // is drawn with. A fill this light needs the edge: without it the
              // squircle stops being a shape and becomes a soft patch.
              className="animate-hero-rise squircle block size-full border border-fg/10 bg-elevated"
              style={{
                borderRadius: MARK_SIZE * MARK_RADIUS,
                animationDelay: `${(i + 1) * 90}ms`,
              }}
            />
          </span>
        )),
      )}
    </span>
  );
}

/**
 * The block above the fold, on `/` and on every `/create/<slug>` page.
 *
 * Only the three strings differ between them. Everything else — the measures,
 * the shadows, the form — is the same block, so it is one component rather
 * than a shape each page reproduces and slowly diverges from.
 */
export function Hero({ title, lede, eyebrow }: HeroProps) {
  // Delays handed out in source order as the rows are written, rather than a
  // fixed step per role. The eyebrow is conditional — the home page passes none
  // — and a fixed table leaves its slot empty there, opening a gap twice the
  // stagger under the mark while every other row stays 90ms apart. Counting
  // what is actually rendered keeps the rhythm even on both pages.
  //
  // A counter and not `nth-child` for the same reason: the selector counts DOM
  // positions, which is the thing that moves.
  let row = 0;
  const rise = () => ({ animationDelay: `${row++ * STAGGER_MS}ms` });

  return (
    // Nothing behind this block, and that is the whole design: paper, the mark,
    // the sentence. There used to be a WebGPU shader stack here — a drifting
    // mesh of the icon's sunrise, read as light pooling in a dark room — and it
    // went when the site did, because that idea has no light-theme equivalent
    // and it was 700kB to say it. The `relative` stays for the flow, not for a
    // canvas to measure itself against.
    <section className="relative overflow-x-clip pt-20 pb-16 sm:pt-28">
      <Container>
        {/* Centred, so `mx-auto` on every width-capped child rather than one
            wrapper: the measures differ on purpose — the headline is allowed to
            run wider than the paragraph, and the form narrower than both — and
            a single `max-w` would flatten that into one column. */}
        <div className="mx-auto max-w-3xl text-center">
          {/* Two shadows: a neutral one for depth and a warm one picking up the
              icon's own sun gradient. The warm one is now the only colour above
              the fold at all, so it carries more than it used to and is set
              wider than the neutral one rather than under it.

              Both are far lighter than the pair this replaced. At 80% black over
              a dark field a drop shadow is depth; on paper it is a grey bruise
              under the mark, and the eye reads the smudge before the icon. */}
          <div className="relative mb-8 flex justify-center">
            <Echoes />
            <div data-hero-enter className="animate-hero-rise" style={rise()}>
              <Logo
                size={MARK_SIZE}
                radius={MARK_RADIUS}
                className="shadow-[0_18px_36px_-14px_rgb(20_21_24_/_0.18),0_16px_52px_-12px_rgb(225_75_21_/_0.35)]"
              />
            </div>
          </div>
          {/* The rows that are wrapped rather than given the class directly —
              this one, the mark above and the button below — are wrapped
              because `Logo`, `Eyebrow` and `DownloadCta` each take a
              `className` and nothing else. All three are used elsewhere, and
              widening three signatures so one caller can hang an animation off
              them is the wrong trade. */}
          {eyebrow ? (
            <div data-hero-enter className="animate-hero-rise" style={rise()}>
              <Eyebrow>{eyebrow}</Eyebrow>
            </div>
          ) : null}
          {/* The leading opens up only when the title contains a chip. A chip
              is taller than the letters around it and tilted on top of that, so
              at 1.05 the raised corner of one on the second line lands in the
              first — but a plain sentence wants the tight setting, and every
              page but the home one passes a plain sentence. `has-` asks the
              content rather than adding a prop each page has to get right. */}
          <h1
            data-hero-enter
            className="animate-hero-rise text-[2rem] leading-[1.05] font-normal tracking-tight text-balance text-fg has-[[data-hero-chip]]:leading-[1.5] sm:text-6xl"
            style={rise()}
          >
            {title}
          </h1>
          <p
            data-hero-enter
            className="animate-hero-rise mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted"
            style={rise()}
          >
            {lede}
          </p>

          <div data-hero-enter className="animate-hero-rise" style={rise()}>
            {/* On the button's own line, and under it on a narrow screen —
                `DownloadCta` handles both. The stack is a second glance at the
                call to action, and at 380px wide the two of them on one line is
                a fight for a row that fits one. */}
            <DownloadCta className="mt-9" beside={<StarredBy />} />
          </div>
        </div>
      </Container>
    </section>
  );
}
