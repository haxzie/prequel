import { Logo } from "@/components/Logo";
import { Container, Eyebrow } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import { SITE } from "@/lib/site";

type HeroProps = {
  title: string;
  lede: string;
  /** Small caps line above the heading. The home page passes none. */
  eyebrow?: string;
};

/**
 * The block above the fold, on `/` and on every `/create/<slug>` page.
 *
 * Only the three strings differ between them. Everything else — the measures,
 * the shadows, the form — is the same block, so it is one component rather
 * than a shape each page reproduces and slowly diverges from.
 */
export function Hero({ title, lede, eyebrow }: HeroProps) {
  return (
    <section className="pt-20 pb-16 sm:pt-28">
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
          <Logo
            size={104}
            radius={0.42}
            className="mb-8 shadow-[0_26px_50px_-16px_rgb(0_0_0_/_0.8),0_14px_46px_-14px_rgb(225_75_21_/_0.5)]"
          />
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="text-[2rem] leading-[1.05] font-normal tracking-tight text-balance text-fg sm:text-6xl">
            {title}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted">
            {lede}
          </p>

          <DownloadCta className="mt-9" />
        </div>
      </Container>
    </section>
  );
}
