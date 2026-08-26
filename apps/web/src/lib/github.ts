/**
 * The repository, and the one number the site reads from it.
 *
 * The owner and name were previously constants inside `app/download/route.ts`,
 * which was fine while one file needed them. Two files disagreeing about which
 * repository this is would be a download button and a star count pointing at
 * different projects, so they live here now and that route imports them.
 */
export const REPO_OWNER = "haxzie";
export const REPO_NAME = "prequel";

export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
export const RELEASES_PAGE = `${REPO_URL}/releases/latest`;
export const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`;

const REPO_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

/**
 * How long a star count is reused for.
 *
 * An hour, against the ten minutes the download route allows itself. Both share
 * one budget — unauthenticated GitHub allows 60 requests an hour *per IP*, and
 * the IP is the serverless region's, shared by every visitor — so this is the
 * one that gives way. A stale download link sends somebody to the wrong
 * version; a stale star count is off by a handful and nobody can tell.
 */
const REVALIDATE = 3600;

/** Raises the limit from 60 an hour to 5,000. Optional, as in the download route. */
export function githubHeaders(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN"];

  return {
    accept: "application/vnd.github+json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * The repository's star count, or null.
 *
 * Null rather than 0 on every failure, and the difference matters at the call
 * site: a repository with no stars and a rate-limited request are not the same
 * thing, and rendering "0" for the second is worse than rendering nothing —
 * it is a number, it looks deliberate, and it is wrong.
 */
export async function stars(): Promise<number | null> {
  try {
    const response = await fetch(REPO_API, {
      headers: githubHeaders(),
      next: { revalidate: REVALIDATE },
    });

    if (!response.ok) {
      console.error(`stars: GitHub answered ${String(response.status)}`);
      return null;
    }

    const repo = (await response.json()) as { stargazers_count?: unknown };

    return typeof repo.stargazers_count === "number" ? repo.stargazers_count : null;
  } catch (error) {
    // The nav renders either way. A star count is decoration on a link that
    // works without it, and a marketing page must not fail to render because
    // GitHub is having a bad afternoon.
    console.error("stars: could not reach GitHub", error);
    return null;
  }
}

/**
 * `1.2k` past a thousand, the plain number below it.
 *
 * Rounded down rather than to nearest, because a count that reads higher than
 * the repository's own page is the one direction this can be wrong in that
 * anybody would notice.
 */
export function formatStars(count: number): string {
  if (count < 1000) return String(count);
  return `${(Math.floor(count / 100) / 10).toFixed(1)}k`;
}
