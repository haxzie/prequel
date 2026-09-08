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
 * Where the release workflow mirrors each disk image.
 *
 * `latest.json` is written by `release-mirror.yml` the moment a release is
 * published, and names the version *and* the URL of the file for that exact
 * version — both halves of the answer, from the job that uploaded it.
 *
 * First because it is ours. Reading it costs nobody a GitHub request, so it can
 * be revalidated in seconds rather than minutes, and the bytes then come off
 * Cloudflare rather than GitHub's release CDN, which on a 100 MB image is the
 * difference between a few seconds and a few minutes.
 */
const MIRROR_URL = "https://assets.prequel.sh/desktop";

/**
 * How long the mirror's manifest is reused for.
 *
 * Sixty seconds, matching the `cache-control` the mirror job puts on
 * `latest.json` itself: that object is the one thing in this chain that
 * changes, and it says how long it is good for. Anything longer here would
 * ignore it.
 */
const MIRROR_REVALIDATE = 60;

/**
 * How long a resolved download is reused for, on the GitHub fallback.
 *
 * Unauthenticated GitHub allows 60 requests an hour *per IP* — and the IP here
 * is the serverless region's, shared by every visitor. Without caching, one
 * good day on Hacker News exhausts the budget and the button starts sending
 * people to the releases page instead. Ten minutes is well inside the limit and
 * well under how often a release actually happens.
 *
 * Only reached when the mirror is unreachable or has nothing for this release,
 * so the ten minutes is now a fallback's staleness rather than the site's.
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
  const build = (await fromMirror()) ?? (await fromGitHub());
  const url = build?.url ?? RELEASES_PAGE;

  track(request, url, build?.version ?? null);

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
function track(request: NextRequest, url: string, version: string | null): void {
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
        // at all: `RELEASES_PAGE` means neither source had anything with a
        // `.dmg` attached, and a rise in that is a broken button.
        version,
        // Which of the two answered. A fall in this is the mirror failing
        // quietly, which costs every visitor a slow download and is otherwise
        // invisible — the button still works.
        source: url.startsWith(MIRROR_URL) ? "mirror" : "github",
        resolved: url !== RELEASES_PAGE,
        // Where the click came from, so the funnel can tell the nav button from
        // the pricing page from a link in someone else's thread.
        referrer: request.headers.get("referer") ?? "$direct",
      },
    }),
  );
}

/** What to send somebody to, and which version it is. */
interface Build {
  url: string;
  /**
   * Null only on the GitHub path, for an asset URL this cannot read a tag out
   * of. The download still works — it is the property on the event that is
   * missing, and a redirect withheld because a regex did not match would be a
   * broken button in exchange for a tidier chart.
   */
  version: string | null;
}

/** The mirror's manifest, or null if it is not there or not readable. */
async function fromMirror(): Promise<Build | null> {
  try {
    const response = await fetch(`${MIRROR_URL}/latest.json`, {
      next: { revalidate: MIRROR_REVALIDATE },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { version?: unknown; url?: unknown };
    if (typeof body.version !== "string" || typeof body.url !== "string") return null;
    // A manifest that names a file somewhere else is a manifest to ignore: this
    // route hands the URL straight to a browser as a redirect.
    if (!body.url.startsWith(`${MIRROR_URL}/`)) return null;

    return { url: body.url, version: body.version };
  } catch {
    // Not fatal, and not logged: the fallback below is the answer, and a mirror
    // that is briefly unreachable is not something anybody needs telling about.
    return null;
  }
}

/** The tag out of a release asset URL, or null when it is not one. */
function versionOf(url: string): string | null {
  return /\/download\/([^/]+)\//.exec(url)?.[1] ?? null;
}

/** The newest stable release carrying a `.dmg`, from GitHub. */
async function fromGitHub(): Promise<Build | null> {
  const url = await current();
  return url ? { url, version: versionOf(url) } : null;
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
