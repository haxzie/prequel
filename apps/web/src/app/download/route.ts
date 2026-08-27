import { after, NextResponse, userAgent, type NextRequest } from "next/server";

import { githubHeaders, RELEASES_API, RELEASES_PAGE } from "@/lib/github";
import { capture, identify } from "@/lib/posthog-server";

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

export async function GET(request: NextRequest): Promise<Response> {
  const url = (await current()) ?? RELEASES_PAGE;

  track(request, url);

  // 302, not 301. A permanent redirect is cached by the browser for as long as
  // it likes, which would pin someone to whichever version they first clicked.
  return NextResponse.redirect(url, 302);
}

/**
 * Records the download.
 *
 * Here rather than on the buttons that link here, for three reasons. This route
 * is the only thing every download has in common — the nav, the footer, pricing,
 * the blog and a URL somebody pasted into Slack all arrive at it. Nothing
 * renders on a redirect, so `posthog-js` never runs and cannot report it. And a
 * server-side event is not something a content blocker can remove, which for the
 * one number the site exists to produce is worth more than the convenience of an
 * `onClick`.
 *
 * Inside `after()`, so the redirect is already on its way: a visitor waiting on
 * PostHog to answer before their download starts would be a worse site in
 * exchange for a chart.
 */
function track(request: NextRequest, url: string): void {
  // Crawlers, uptime checks and every chat app that unfurls a link all hit this
  // URL, and none of them installed anything. Counted as downloads they would
  // not just inflate the number — they would move it whenever somebody shared
  // the link, which is exactly when the real number is interesting.
  if (userAgent(request).isBot) return;

  // A callback, not a promise: passing `capture(...)` would start the request
  // here, before the redirect is written, which is the one thing this is
  // arranged to avoid.
  after(() =>
    capture("download_started", {
      distinctId: identify(request),
      properties: {
        // Which build people are actually installing, and whether they got one
        // at all: `RELEASES_PAGE` means GitHub was unreachable or had nothing
        // with a `.dmg` attached, and a rise in that is a broken button.
        version: versionOf(url),
        resolved: url !== RELEASES_PAGE,
        // Where the click came from, so the funnel can tell the nav button from
        // the pricing page from a link in someone else's thread.
        referrer: request.headers.get("referer") ?? "$direct",
      },
    }),
  );
}

/** The tag out of a release asset URL, or null when it is not one. */
function versionOf(url: string): string | null {
  return /\/download\/([^/]+)\//.exec(url)?.[1] ?? null;
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
