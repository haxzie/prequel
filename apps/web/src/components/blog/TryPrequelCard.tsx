import { ButtonLink } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { TRIAL_DAYS } from "@/lib/pricing";

/**
 * The call to action in a post's right-hand rail, under the contents.
 *
 * The narrow sibling of `TryItAside`, which is the panel at the foot of a post
 * and is shared with the articles. Not that component at a smaller size: this
 * one sits in an 11rem track, where the mark-beside-text row it is built from
 * has nowhere to go, so the two are laid out differently and only the words
 * and the destination are the same.
 *
 * The post page hides `TryItAside` from `xl`, which is the width this appears
 * at, so a reader only ever sees one of the two. That is not tidiness: the note
 * on the `cta` variant in `Button.tsx` says two filled blues on a screen are
 * two primary actions, which is none, and a sticky rail would otherwise put a
 * second one beside the panel for the whole of the last screenful.
 */
export function TryPrequelCard() {
  return (
    <aside className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5">
      {/* The same wash `TryItAside` carries, turned down the page rather than
          across it. The panel is taller than it is wide here, so a
          left-to-right gradient would run out inside the first line of text
          and read as a seam down the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, rgb(225 75 21 / 0.09), rgb(225 75 21 / 0.03) 38%, transparent 72%)",
        }}
      />
      <div className="relative">
        <Logo
          size={36}
          radius={0.42}
          className="shadow-[0_8px_18px_-10px_rgb(20_21_24_/_0.18),0_8px_22px_-10px_rgb(225_75_21_/_0.3)]"
        />
        <p className="mt-3.5 text-sm font-medium text-fg">Try Prequel</p>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          Record your screen and get back a finished video, with the zooms already placed. Free for{" "}
          {TRIAL_DAYS} days.
        </p>
        {/* `size="sm"` and full width: at 11rem the medium button's 1.5rem of
            horizontal padding leaves "Download for Mac" nowhere to sit and it
            wraps onto two lines. */}
        <ButtonLink href="/download" variant="cta" size="sm" className="mt-4 w-full">
          Download for Mac
        </ButtonLink>
      </div>
    </aside>
  );
}
