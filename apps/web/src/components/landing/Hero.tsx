import { Logo } from "@/components/Logo";
import { Container, Eyebrow } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import { HeroBackdrop } from "@/components/landing/HeroBackdrop";
import { ShaderWash } from "@/components/landing/ShaderWash";
import { SITE } from "@/lib/site";

type HeroProps = {
  title: string;
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
    // `relative` so the shader behind this block has something to measure its
    // offsets against, and nothing else: `position: relative` with an automatic
    // z-index creates no stacking context, so the backdrop's `-z-10` still
    // escapes to the body's — which is the layer the CSS wash already sits in.
    // Adding `isolate` here would trap it and paint it behind the page.
    <section className="relative pt-20 pb-16 sm:pt-28">
      {/* Order matters: both sit at `-z-10` in the same box, so the shader is
          painted over the static backdrop only because it comes second. */}
      <HeroBackdrop />
      <ShaderWash />
      <Container>
        {/* Centred, so `mx-auto` on every width-capped child rather than one
            wrapper: the measures differ on purpose — the headline is allowed to
            run wider than the paragraph, and the form narrower than both — and
            a single `max-w` would flatten that into one column. */}
        <div className="mx-auto max-w-3xl text-center">
          {/* Two shadows: a neutral one for depth and a warm one picking up
              the icon's own sun gradient. On a flat background that warm
              halo is the only colour above the fold, so it does the work the
              section background used to. */}
          <div data-hero-enter className="animate-hero-rise" style={rise()}>
            <Logo
              size={104}
              radius={0.42}
              className="mb-8 shadow-[0_26px_50px_-16px_rgb(0_0_0_/_0.8),0_14px_46px_-14px_rgb(225_75_21_/_0.5)]"
            />
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
          <h1
            data-hero-enter
            className="animate-hero-rise text-[2rem] leading-[1.05] font-normal tracking-tight text-balance text-fg sm:text-6xl"
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
            <DownloadCta className="mt-9" />
          </div>
        </div>
      </Container>
    </section>
  );
}
