import { NextResponse } from "next/server";

import { githubHeaders, RELEASES_API, RELEASES_PAGE } from "@/lib/github";

/**
 * `prequel.sh/download` → the current `.dmg`.
 *
 * A redirect rather than a link straight to GitHub, because the download URL
 * carries a version and every place that links to it would otherwise have to be
 * edited on every release — the site, the docs, whatever someone pasted into a
 * thread last month. This URL never changes.
 *
 * It lives on the site rather than in `apps/api` on purpose. The rule in
 * `AGENTS.md` is about APIs the apps *call*; this is a public page URL people
 * share, and it has to sit on the same host as the pages that link to it or the
 * link reads as somebody else's.
 */

/**
 * How long a resolved download is reused for.
 *
 * Unauthenticated GitHub allows 60 requests an hour *per IP* — and the IP here
 * is the serverless region's, shared by every visitor. Without caching, one
 * good day on Hacker News exhausts the budget and the button starts sending
 * people to the releases page instead. Ten minutes is well inside the limit and
 * well under how often a release actually happens.
 */
const REVALIDATE = 600;

/** A tag that is not a real release, even when GitHub does not mark it one. */
const PRERELEASE_TAG = /-(?:beta|alpha|rc|canary|next|dev|nightly)\b/i;

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

export async function GET(): Promise<Response> {
  const url = (await current()) ?? RELEASES_PAGE;

  // 302, not 301. A permanent redirect is cached by the browser for as long as
  // it likes, which would pin someone to whichever version they first clicked.
  return NextResponse.redirect(url, 302);
}

/** The newest stable release carrying a `.dmg`, or null. */
async function current(): Promise<string | null> {
  let releases: Release[];

  try {
    const response = await fetch(RELEASES_API, {
      headers: githubHeaders(),
      next: { revalidate: REVALIDATE },
    });

    if (!response.ok) {
      console.error(`download: GitHub answered ${response.status}`);
      return null;
    }

    releases = (await response.json()) as Release[];
  } catch (error) {
    // Never fatal. The caller falls back to the releases page, which is a worse
    // experience than a direct download and a much better one than an error.
    console.error("download: GitHub unreachable", error);
    return null;
  }

  if (!Array.isArray(releases)) return null;

  // GitHub returns these newest first, so the first match in each pass is the
  // most recent one.
  const usable = releases.filter((release) => !release.draft);

  const stable = usable.find(
    (release) => !release.prerelease && !PRERELEASE_TAG.test(release.tag_name) && dmg(release),
  );
  if (stable) return dmg(stable);

  // Nothing stable has a build attached — a release cut before its artefacts
  // finished uploading, or a run of prereleases. Sending people to the newest
  // thing they can actually install beats sending them nowhere.
  const anything = usable.find(dmg);
  return anything ? dmg(anything) : null;
}

/** The release's `.dmg` download URL, if it has one. */
function dmg(release: Release): string | null {
  const asset = release.assets.find((candidate) => candidate.name.toLowerCase().endsWith(".dmg"));
  return asset?.browser_download_url ?? null;
}
