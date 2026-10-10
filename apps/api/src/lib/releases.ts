/**
 * The mirror on `assets.prequel.sh`, as the desktop app's update feed.
 *
 * This used to redirect at `github.com/<repo>/releases/…`. It cannot: the
 * repository is private, so every asset URL on `github.com` answers 404 to a
 * request with no token — and `electron-updater` sends none. Every installed
 * copy checked, got a 404 for the channel file, and showed "Prequel couldn't
 * check for updates" with no release notes under it. Nothing in a shipped app
 * can be changed to fix that, because the feed URL baked into it is this
 * Worker; the only lever is where this Worker points.
 *
 * So `release-mirror.yml` copies the whole update payload — the channel file,
 * the zip, the disk image and the notes — to R2 as each release is published,
 * and everything here resolves against that. The GitHub release stays the
 * source of truth the mirror is built from, and nothing on the user's path
 * touches it.
 *
 * `api.github.com` is gone from this file for the same reason, notes included:
 * a private repository's releases are not readable without a token, and a token
 * in the Worker would be a credential to rotate in exchange for a changelog the
 * mirror can carry as a file.
 */

/** What the mirror writes beside each version, of the parts anything reads. */
interface Notes {
  notes: string | null;
  publishedAt: string | null;
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

/**
 * Where to send electron-updater for one file.
 *
 * `null` for a filename that is not safe to put in a URL.
 *
 * A versioned name resolves under its own version's prefix rather than under
 * whatever is newest. That matters more than it looks: the updater is routinely
 * asked for files belonging to the version it is replacing — were a differential
 * download ever allowed it would want the *old* release's `.zip.blockmap` — and
 * a feed that only ever answers "latest" 404s every one of those.
 *
 * `latest-mac.yml` is the one object that moves, so it has no version to resolve
 * against and sits at the top of the prefix. It is written last by the mirror,
 * after the files it names, so it never points at a zip that is not there yet.
 */
export function assetRedirect(mirror: string, file: string): string | null {
  if (!SAFE_FILENAME.test(file)) return null;

  const version = file.match(VERSIONED_ASSET)?.[1];

  return version ? `${mirror}/${version}/${file}` : `${mirror}/${file}`;
}

/**
 * The notes for a version, for the update window's changelog.
 *
 * Every failure is `null` rather than a throw. A changelog the modal could not
 * fetch is a modal without a changelog, not a failed update check — and a
 * version released before the mirror carried notes has none to find.
 */
export async function notesForVersion(mirror: string, version: string): Promise<Notes | null> {
  const url = `${mirror}/${version}/notes.json`;

  const response = await fetch(url).catch((error: unknown) => {
    console.error("releases: mirror unreachable", error);
    return null;
  });

  if (!response) return null;

  if (!response.ok) {
    console.error(`releases: mirror answered ${response.status} for ${url}`);
    return null;
  }

  return (await response.json().catch(() => null)) as Notes | null;
}
