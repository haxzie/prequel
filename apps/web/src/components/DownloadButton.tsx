import { ButtonLink } from "@/components/Button";
import { AppleIcon, CardIcon } from "@/components/icons";

/**
 * The one call to action on the site.
 *
 * `/download` rather than a release URL: that carries a version, so every place
 * linking to it would need editing on every release — including whatever
 * someone pasted into a thread last month. The route resolves the current build
 * and redirects.
 */
export function DownloadCta({
  className = "",
  /**
   * Something to set on the button's own line — the stack of faces, in the
   * hero.
   *
   * A slot rather than a row built around `DownloadCta` by the caller: the
   * button sits in a box that centres it, so anything placed *next to that box*
   * ends up half a column away from the button rather than beside it. In here
   * it shares the button's line, and the small print stays under both.
   */
  beside,
}: {
  className?: string;
  beside?: React.ReactNode;
}): React.ReactNode {
  return (
    // Wide enough for the pair on one line when there is something beside the
    // button, and the original width when there is not — every other caller
    // passes nothing and must not reflow.
    <div className={`mx-auto ${beside ? "max-w-2xl" : "max-w-lg"} ${className}`}>
      {/* The frame around the pair.
          
          `w-fit mx-auto` so it hugs its contents: stretched to the column it
          would be a bar across the hero rather than a frame around a button.
          The padding is one step, and the radius is `rounded-full` against the
          button's own — a rounded rectangle around a pill leaves four crescents
          of glass at the corners, which is the shape you notice.
          
          `backdrop-blur` over a flat panel colour, because what is behind it
          here is the hero's gradient and the wash moving under it; a solid
          would cut a hole in both. The border follows the site's hairline
          idiom, and `lit` is the one-pixel inner highlight every raised surface
          on this page carries. */}
      <div
        className={
          "lit mx-auto flex w-fit flex-col items-center justify-center gap-4 rounded-full " +
          "border border-white/8 bg-white/5 p-1.5 backdrop-blur-md sm:flex-row"
        }
      >
        <ButtonLink href="/download">
          {/* `-mt-0.5` for the leaf, which puts the mark's optical centre below
              its geometric one — vertically centred, it sits visibly low next to
              the cap height of the text. The gap comes from `ButtonLink`. */}
          <AppleIcon className="-mt-0.5 size-[1.05rem]" />
          Download for Mac
        </ButtonLink>
        {/* Padded off the frame's right edge, which the button does not need:
            it is a filled pill and its own edge is the shape. Loose discs sat
            against the glass read as having been cut off by it. */}
        {beside === undefined ? null : <span className="pr-2.5 sm:pl-0.5">{beside}</span>}
      </div>
      {/* What the button costs, which is nothing — the one objection worth
          answering at the moment somebody is deciding to click it.
          
          The platform and the trial length used to be here. Both are still on
          the page: the footer says which Macs the build runs on, and the
          pricing section a screen down says how long the trial is. Neither is
          the thing a hand hovering over a download button is worried about. */}
      <p className="mt-3.5 flex items-center justify-center gap-1.5 font-mono text-[11px] tracking-wide text-muted">
        <CardIcon className="size-3.5" />
        No credit card required
      </p>
    </div>
  );
}
