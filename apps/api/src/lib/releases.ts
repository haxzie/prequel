/**
 * GitHub Releases, as the desktop app's update feed.
 *
 * Two jobs that look alike and are deliberately kept apart.
 *
 * The **download path** — the channel file and the zip electron-updater fetches
 * — never touches `api.github.com`. It derives the tag from the filename that
 * was asked for and redirects to `github.com/<repo>/releases/…`, which resolves
 * the tag itself. That is not a shortcut: the API is rate limited to 60 requests
 * an hour per source IP, and a Worker egresses from an address it shares with
 * everything else on Cloudflare, so putting it in the download path puts a limit
 * nobody can see on every user's update. Deriving from the filename also gets
 * the *previous* version's assets right, which "resolve the latest release"
 * cannot — see `assetRedirect`.
 *
 * The **notes** are the only thing that needs the API, because a release body is
 * not an asset. One call, once per update check, on a path where failing is
 * merely a modal with no changelog in it.
 */

/** What the API returns, of the parts anything here reads. */
interface Release {
  draft: boolean;
  body: string | null;
  published_at: string | null;
}

/**
 * The version electron-builder stamps into an artefact name.
 *
 * `Prequel-0.0.3-arm64-mac.zip`, `Prequel-0.0.3-arm64.dmg` — both carry it, and
 * the channel file lists both. `latest-mac.yml` carries no version at all, which
 * is what tells the two cases apart.
 */
const VERSIONED_ASSET = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-arm64/;

/**
 * A filename safe to interpolate into a URL.
 *
 * Without this the route is an open redirect on the API's own origin: a `:file`
 * containing `..` or a second host would send anyone following it somewhere
 * else, over a domain they have reason to trust.
 */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

/** GitHub answers 403 to a request with no user agent. */
const USER_AGENT = "prequel-api";

/**
 * Where to send electron-updater for one file.
 *
 * `null` for a filename that is not safe to put in a URL.
 *
 * A versioned name resolves to its own tag rather than to whatever is latest.
 * That matters more than it looks: were the updater ever allowed a differential
 * download it would ask for the *old* version's `.zip.blockmap`, and that asset
 * only exists on the old release. Resolving everything against "latest" would
 * 404 every one of those, and would break outright the moment a user two
 * versions behind is offered the one in between.
 *
 * `latest-mac.yml` has no version in it, and GitHub's own `/releases/latest/`
 * already means the newest release that is neither a draft nor a prerelease —
 * the same rule this file would otherwise implement by hand, applied by the
 * service that owns the answer.
 */
export function assetRedirect(repo: string, file: string): string | null {
  if (!SAFE_FILENAME.test(file)) return null;

  const version = file.match(VERSIONED_ASSET)?.[1];

  return version
    ? `https://github.com/${repo}/releases/download/v${version}/${file}`
    : `https://github.com/${repo}/releases/latest/download/${file}`;
}

/**
 * The release for a version, for its body.
 *
 * By tag rather than a listing: the caller already knows the version, because
 * the updater is what told it. A token is optional and only raises the rate
 * limit — this is public data.
 *
 * Every failure is `null` rather than a throw. A changelog the modal could not
 * fetch is a modal without a changelog, not a failed update check.
 */
export async function releaseForVersion(
  repo: string,
  version: string,
  token?: string,
): Promise<Release | null> {
  const url = `https://api.github.com/repos/${repo}/releases/tags/v${version}`;

  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": USER_AGENT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }).catch((error: unknown) => {
    console.error("releases: github unreachable", error);
    return null;
  });

  if (!response) return null;

  if (!response.ok) {
    console.error(`releases: github answered ${response.status} for ${url}`);
    return null;
  }

  const release = (await response.json().catch(() => null)) as Release | null;
  if (!release || release.draft) return null;

  return release;
}
