import { formatStars, REPO_URL, stars } from "@/lib/github";

import { GitHubIcon, StarIcon } from "./icons";

/**
 * A link to the repository, with its star count.
 *
 * An async server component, so the count is fetched on the server and cached
 * for an hour — see `lib/github.ts`. Nothing about it reaches the browser as
 * JavaScript, and no visitor's request ever touches GitHub.
 *
 * Sized and shaped like the secondary controls beside it rather than like the
 * download button: this is somewhere to look, not the thing the page is asking
 * anyone to do.
 */
export async function GitHubStars() {
  const count = await stars();

  return (
    <a
      href={REPO_URL}
      target="_blank"
      // `noreferrer` as well as `noopener`. The first is what closes the
      // `window.opener` hole; the second is the one that stops the referrer
      // header going out, and they are not the same flag.
      rel="noopener noreferrer"
      className={
        "flex items-center gap-2 rounded-full px-3 py-2 text-sm text-fg transition-colors " +
        "hover:bg-white/8"
      }
      // The count is decoration a screen reader would read as a bare number
      // hanging off a link, so the whole control gets one name instead.
      aria-label={
        count === null
          ? "Prequel on GitHub"
          : `Prequel on GitHub, ${String(count)} ${count === 1 ? "star" : "stars"}`
      }
    >
      <GitHubIcon className="size-4" />

      {/* Absent, not zero. `stars` answers null when GitHub could not be
          reached, and a rate-limited request rendered as "0" is a number that
          looks deliberate and is wrong — the link is worth having either way. */}
      {count !== null && (
        <span className="flex items-center gap-1 text-muted" aria-hidden="true">
          <StarIcon className="size-3" />
          {formatStars(count)}
        </span>
      )}
    </a>
  );
}
