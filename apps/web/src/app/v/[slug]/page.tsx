import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { API_URL } from "@/lib/api";
import { absoluteUrl, OG_IMAGE } from "@/lib/seo";
import { SITE } from "@/lib/site";

/**
 * Dynamic, and it has to be.
 *
 * `src` below is a presigned R2 URL with a six-hour life. A statically rendered
 * copy of this page would serve an expired one to everybody who arrived after
 * the build, and the failure looks like a video that will not play rather than
 * like a stale cache.
 *
 * Note this is the opposite of every other dynamic route in the app, which all
 * set `dynamicParams = false` and prerender their whole set.
 */
export const dynamic = "force-dynamic";

interface Shared {
  title: string;
  contentType: string;
  durationMs: number;
  width: number;
  height: number;
  teamName: string | null;
  createdAt: string;
  src: string;
  poster: string | null;
}

/**
 * Three outcomes, not two.
 *
 * The API distinguishes a slug that never existed from a recording that was
 * deliberately taken down — 404 against 410 — and the difference is the whole
 * reason `video` rows are soft-deleted rather than dropped. Collapsing both to
 * `null` throws that away and tells somebody holding a link their sender
 * deleted on purpose that the link was never real.
 */
type Lookup = { status: "ok"; shared: Shared } | { status: "deleted" } | { status: "missing" };

async function fetchShared(slug: string): Promise<Lookup> {
  const response = await fetch(`${API_URL}/p/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  }).catch(() => null);

  if (response?.ok) return { status: "ok", shared: (await response.json()) as Shared };
  if (response?.status === 410) return { status: "deleted" };
  return { status: "missing" };
}

/**
 * The card a pasted link unfurls into.
 *
 * This is the whole reason a share link is worth having over a file: it has to
 * look like something in Slack. The poster is the video's own still, so the
 * preview is the recording rather than a Prequel logo.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const found = await fetchShared(slug);

  if (found.status !== "ok") {
    return {
      title: found.status === "deleted" ? "Recording deleted" : "Recording not found",
      robots: { index: false, follow: false },
    };
  }

  const shared = found.shared;

  const url = absoluteUrl(`/v/${slug}`);

  return {
    title: shared.title,
    description: shared.teamName
      ? `A recording shared by ${shared.teamName}.`
      : "A recording shared with Prequel.",
    alternates: { canonical: `/v/${slug}` },
    // Unlisted, not public. The link is meant to be sent to somebody, not found
    // in a search result — indexing it would turn "anyone with the link" into
    // "anyone at all", which is not what sharing was understood to mean.
    robots: { index: false, follow: false },
    openGraph: {
      type: "video.other",
      siteName: SITE.name,
      title: shared.title,
      url,
      // The recording's own still where there is one, and the brand card where
      // there is not. A share link with no image at all is the one outcome this
      // page cannot afford: looking like something in Slack is the whole reason
      // it exists, and a recording whose poster never uploaded is not a reason
      // to fall back to a bare text link.
      images: shared.poster ? [{ url: shared.poster }] : [OG_IMAGE],
    },
    twitter: {
      card: "player",
      title: shared.title,
      images: [shared.poster ?? OG_IMAGE.url],
    },
  };
}

/**
 * When it was shared, in the viewer's own locale but a fixed timezone.
 *
 * `UTC` pinned because this string is rendered on the server and again on the
 * client; a timezone difference between the two is a hydration mismatch React
 * reports as an error on every view.
 */
function formatShared(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function SharedVideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await fetchShared(slug);

  // `notFound()` renders `v/not-found.tsx`, which lives inside this route's own
  // layout — so a dead link keeps the player's chrome instead of dropping a
  // stranger onto the marketing site's 404 with a link to the blog.
  if (found.status === "missing") notFound();

  if (found.status === "deleted") {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-24 text-center sm:px-8">
        <h1 className="text-xl font-medium tracking-tight text-fg">This recording was deleted</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Whoever shared it has taken it down. Ask them for a new link if you still need it.
        </p>
      </div>
    );
  }

  const shared = found.shared;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-8 sm:px-8">
      <div className="overflow-hidden rounded-2xl border border-line bg-black">
        {shared.contentType === "image/gif" ? (
          // A GIF is not a video and a `<video>` pointed at one shows nothing at
          // all — no error, just a black rectangle with controls.
          <img src={shared.src} alt={shared.title} className="block w-full" />
        ) : (
          <video
            src={shared.src}
            poster={shared.poster ?? undefined}
            controls
            playsInline
            // `metadata` rather than `auto`: the browser fetches enough to draw
            // the scrubber and no more, so opening a link does not pull a
            // hundred megabytes down for somebody who never presses play.
            preload="metadata"
            className="block max-h-[75dvh] w-full bg-black"
          />
        )}
      </div>

      {/* No second Prequel mark here — the bar above already carries it, and
          the same wordmark twice on one short page reads as a template that
          could not decide. What belongs under the video is whose recording it
          is. */}
      <div className="mt-6 min-w-0">
        <h1 className="text-xl font-medium tracking-tight text-fg">{shared.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {shared.teamName ? `Shared by ${shared.teamName}` : "Shared with Prequel"}
          {shared.createdAt ? ` · ${formatShared(shared.createdAt)}` : ""}
        </p>
      </div>
    </div>
  );
}
