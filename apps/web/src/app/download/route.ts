import { after, NextResponse, userAgent, type NextRequest } from "next/server";

import { capture, identify } from "@/lib/posthog-server";

/**
 * `prequel.sh/download` → the current `.dmg`.
 *
 * A redirect rather than a link straight at the file, because the download URL
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
 * The only source. There is no second one to fall back to, so a manifest this
 * route cannot read is a button that gives an error rather than a button that
 * quietly sends somebody somewhere else.
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

export async function GET(request: NextRequest): Promise<Response> {
  const build = await fromMirror();

  track(request, build);

  // 503 rather than a redirect to somewhere a visitor could hunt for the file
  // themselves. The mirror is the only source, so an unreadable manifest is
  // this route having no answer, and saying so is what puts it in the logs and
  // in the `resolved` figure on the event instead of hiding it behind a
  // page that looks like it worked.
  if (!build) {
    console.error("download: the mirror had no build");
    return new NextResponse("No build available. Write to support@prequel.sh.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // 302, not 301. A permanent redirect is cached by the browser for as long as
  // it likes, which would pin someone to whichever version they first clicked.
  return NextResponse.redirect(build.url, 302);
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
function track(request: NextRequest, build: Build | null): void {
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
        // at all: null means the mirror had nothing to send them, and a rise in
        // that is a broken button.
        version: build?.version ?? null,
        resolved: build !== null,
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
  version: string;
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
    // Not logged here. The caller logs the one line that matters — that there
    // is no build to send anybody — and a second line for every way of getting
    // there only makes that one harder to find.
    return null;
  }
}
