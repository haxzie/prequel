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
   * action: no frame, and aligned to the start of the column.
   *
   * The footer, and only the footer. The frame exists to gather a centred pair
   * into one object in the middle of a page; in a left-aligned column there is
   * nothing to gather and a panel around a single button reads as a second,
   * quieter call to action competing with the real one further up. One prop
   * rather than two because the two always travel together — a framed button
   * aligned left is a box with a ragged edge against the paragraph above it.
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
      {/* The frame around the pair.
          
          `w-fit mx-auto` so it hugs its contents: stretched to the column it
          would be a bar across the hero rather than a frame around a button.
          The padding is one step, and the radius is `rounded-full` against the
          button's own — a rounded rectangle around a pill leaves four crescents
          of glass at the corners, which is the shape you notice.
          
          A flat grey panel, one step off the page. It used to be a pane of
          glass — a white film over a `backdrop-blur` — because what sat behind it
          was the hero's shader and the wash drifting under it, and a solid would
          have cut a hole in both. There is nothing behind it now, and a blur with
          nothing to blur is a composited layer for no reason. The border follows
          the site's hairline idiom, and `lit` is the one-pixel inner highlight
          every raised surface on this page carries.

          From `sm` up, and only there. The frame exists to gather a centred
          *pair* into one object, and below `sm` there is no pair — the row
          becomes a column, so the panel stops being a frame around two things
          and becomes a tall grey slab with a pill at the top and four faces
          adrift at the bottom. `rounded-full` on a box that height is a stadium
          rather than a frame, which is what makes it read as broken rather than
          as plain. Nothing is drawn on a phone: the button is already a filled
          pill and carries its own shape. */}
      <div
        className={
          "flex w-fit flex-col gap-4 rounded-full sm:flex-row " +
          (bare
            ? "items-start justify-start"
            : "mx-auto items-center justify-center sm:lit sm:border sm:border-line sm:bg-elevated sm:p-1.5")
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
            against the glass read as having been cut off by it.

            With the frame, so both go at `sm`. Below it there is no edge to
            stand off, and the padding only pulls the row of faces off the
            centre the column puts everything else on. */}
        {beside === undefined ? null : <span className="sm:pr-2.5 sm:pl-0.5">{beside}</span>}
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
