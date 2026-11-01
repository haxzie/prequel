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
  /**
   * The button as one item in a column of copy rather than as the page's call to
   * action: aligned to the start of the column rather than centred on it.
   *
   * The footer, and only the footer. It used to turn off a panel as well —
   * everywhere else drew one around the pair — and that panel is gone from
   * every caller now, so what is left is the alignment. The prop stays because
   * the footer still needs it, and because a left-aligned button centred in its
   * own column is a ragged edge against the paragraph above it.
   */
  bare = false,
}: {
  className?: string;
  beside?: React.ReactNode;
  bare?: boolean;
}): React.ReactNode {
  return (
    // Wide enough for the pair on one line when there is something beside the
    // button, and the original width when there is not — every other caller
    // passes nothing and must not reflow.
    <div className={`${bare ? "" : "mx-auto"} ${beside ? "max-w-2xl" : "max-w-lg"} ${className}`}>
      {/* The button and whatever shares its line, and nothing drawn around
          them.

          There was a frame here: a grey panel, a hairline border and the `lit`
          inner highlight, from `sm` up. It was built to gather the pair into
          one object when the hero had a shader drifting behind it — first as a
          pane of glass over that, then as a flat panel when the shader went.
          The page is paper now and nothing sits behind the button at all, so
          the panel was a grey shape around the one filled pill above the fold,
          competing with the only thing up there that is meant to be clicked. A
          filled button carries its own shape.

          `w-fit` so the row still hugs its contents rather than stretching to
          the column, which is what keeps the faces beside the button rather
          than at the far end of a bar. */}
      <div
        className={
          "flex w-fit flex-col gap-4 sm:flex-row " +
          (bare ? "items-start justify-start" : "mx-auto items-center justify-center")
        }
      >
        <ButtonLink href="/download" variant="cta">
          {/* `-mt-0.5` for the leaf, which puts the mark's optical centre below
              its geometric one — vertically centred, it sits visibly low next to
              the cap height of the text. The gap comes from `ButtonLink`. */}
          <AppleIcon className="-mt-0.5 size-[1.05rem]" />
          Download for Mac
        </ButtonLink>
        {/* No padding of its own any more: it used to stand the discs off the
            frame's right edge, where sitting against the panel read as having
            been cut off by it. With the panel gone there is no edge to stand
            off, and the inset only pulled the faces away from the button they
            belong to. The row's `gap-4` is the whole spacing. */}
        {beside === undefined ? null : <span>{beside}</span>}
      </div>
      {/* What the button costs, which is nothing — the one objection worth
          answering at the moment somebody is deciding to click it.
          
          The platform and the trial length used to be here. Both are still on
          the page: the footer says which Macs the build runs on, and the
          pricing section a screen down says how long the trial is. Neither is
          the thing a hand hovering over a download button is worried about. */}
      <p
        className={
          "mt-3.5 flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted " +
          (bare ? "justify-start" : "justify-center")
        }
      >
        <CardIcon className="size-3.5" />
        No credit card required
      </p>
    </div>
  );
}
