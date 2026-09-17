import type { CSSProperties } from "react";

import { ButtonLink } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { TRIAL_DAYS } from "@/lib/pricing";

/**
 * The mark, as a variable so the button below it can indent to the text
 * rather than to the panel edge without the two sizes drifting apart.
 */
const MARK_SIZE = 72;

/**
 * The panel at the foot of a post or an article: the mark, two lines, and
 * the download button.
 *
 * One component for both kinds of page. The blog post carried this inline
 * until the articles arrived, and a second copy is how the two would come to
 * make different promises under the same heading.
 */
export function TryItAside() {
  return (
    <aside
      className="relative mt-16 overflow-hidden rounded-2xl border border-line bg-surface p-7"
      style={{ "--mark-size": `${MARK_SIZE}px` } as CSSProperties}
    >
      {/* A wash under the mark that is gone before the text ends, so the
          colour reads as coming off the icon's own sun gradient rather than as
          a tinted panel. Linear rather than radial: a radial centred on the
          mark bleeds through the left border and thickens it. `overflow-hidden`
          on the panel is what keeps the layer inside the corner radius.

          Weaker than it was, and doing the opposite job. Over a near-black
          panel this was an additive lift and needed 18% to register at all; on
          a light one the same figure is a peach block with a hard end to it.
          Enough now to tint the corner the mark sits in. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(225 75 21 / 0.09), rgb(225 75 21 / 0.03) 34%, transparent 68%)",
        }}
      />
      {/* The mark centres on the heading and paragraph alone, so the row is
          its own flex container and the button sits outside it. With the
          button inside, the column it centres against is taller and the mark
          drifts below the heading. */}
      <div className="relative flex items-center gap-6">
        {/* The same warm halo the hero mark carries, at the smaller size — and
            lightened with it, for the reason written out there: a 70%-black
            drop shadow on a light panel is a smudge the eye reads before the
            icon. */}
        <Logo
          size={MARK_SIZE}
          radius={0.42}
          className="shadow-[0_12px_24px_-12px_rgb(20_21_24_/_0.16),0_10px_30px_-10px_rgb(225_75_21_/_0.32)]"
        />
        <div>
          <h2 className="text-base font-medium text-fg">Try it yourself</h2>
          <p className="mt-2 text-sm text-muted">
            Prequel records your screen and hands back a finished video. Free for {TRIAL_DAYS}{" "}
            days, with no watermark on anything you export.
          </p>
        </div>
      </div>
      {/* Indented to the text above rather than the panel edge — the mark's
          width plus the row's gap. */}
      <ButtonLink href="/download" className="relative mt-5 ml-[calc(var(--mark-size)_+_1.5rem)]">
        Download for Mac
      </ButtonLink>
    </aside>
  );
}
