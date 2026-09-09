import Image from "next/image";

/**
 * Four faces and a tally, on the download button's own line.
 *
 * The four are real people who starred the repository, and their pictures are
 * copies under `public/` rather than `avatars.githubusercontent.com` links.
 * Hotlinking would put a request to GitHub in front of every visitor, which is
 * the property `GitHubStars` goes out of its way to keep — it fetches on the
 * server so that no visitor's browser ever touches GitHub — and one row of
 * decoration is not the thing to give it up for.
 *
 * The last disc is the count rather than a fourth face, which is the shape this
 * pattern has everywhere it appears: faces, then how many more there are. It is
 * a hard-coded figure and not the repository's — `stars()` in `lib/github.ts`
 * is the live number, already fetched and cached for the nav, and swapping
 * `MORE` for it is a one-line change.
 *
 * Hovering says who they are. CSS only — `group-hover` on a span that is always
 * in the markup — because a tooltip that needs a client component, an effect
 * and a state update to fade a line of text in is three moving parts for
 * something a hover selector does, on a page that ships almost no JavaScript.
 */

/** Most recent first, which is the rule behind who is shown rather than a pick. */
const FACES = [
  { login: "sdesale-coursera", src: "/stargazers/sdesale-coursera.jpg" },
  { login: "jaseemts", src: "/stargazers/jaseemts.jpg" },
  { login: "YZhuAndrew", src: "/stargazers/YZhuAndrew.jpg" },
  { login: "keskinonur", src: "/stargazers/keskinonur.jpg" },
];

const MORE = "+1k";

const TOOLTIP = "Liked by 1000s of creators";

/** One disc, so the tally cannot drift from the faces it stands in line with. */
const DISC = "size-7 shrink-0 rounded-full ring-2 ring-bg";

export function StarredBy({ className = "" }: { className?: string }) {
  return (
    // One `role="img"` with the tooltip's own words as its name, rather than
    // four logins and a "+1k" read out one at a time. The sentence a hover
    // gives is then the sentence a screen reader gives, from one string — the
    // alternative is a picture that says nothing and a tooltip nobody but a
    // mouse can reach.
    <div className={`group relative flex -space-x-2 ${className}`} role="img" aria-label={TOOLTIP}>
      {FACES.map((face) => (
        <Image
          key={face.login}
          src={face.src}
          alt=""
          width={28}
          height={28}
          // The page's own colour, which is what separates the discs from each
          // other where they overlap: the ring knocks each face out of the one
          // behind it. It was a literal white when the page was near-black —
          // which read as a rim rather than a gap, and vanished the moment the
          // page turned to paper. Same idiom as the changelog's rail nodes.
          className={`${DISC} object-cover`}
        />
      ))}

      {/* Last, so the row reads left to right as faces and then the rest of
          them. The ink colour, matching the button it stands beside, with the
          count knocked out of it.

          `text-bg/60` rather than the site's `--muted`: that grey is tuned for
          type on the page itself and comes out near 3:1 against this disc, which
          at ten pixels is a smudge. This is the page's own ground, let down until
          it reads as grey rather than as a second label. */}
      <span
        className={`${DISC} grid place-items-center bg-fg text-[10px] leading-none font-medium tracking-tight text-bg/60`}
      >
        {MORE}
      </span>

      {/* Always rendered and faded, not mounted on hover: opacity is a
          compositor property and a tooltip that appears by being added to the
          DOM lays the page out again under the pointer. `pointer-events-none`
          so it cannot take the hover it is showing for and flicker.

          Above the stack, because below it is the small print and the tooltip
          would cover the line that says what the download costs. */}
      <span
        role="tooltip"
        className={
          "lit pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 " +
          "rounded-lg border border-fg/8 bg-elevated px-2.5 py-1.5 text-xs whitespace-nowrap " +
          "text-fg opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
        }
      >
        {TOOLTIP}
      </span>
    </div>
  );
}
