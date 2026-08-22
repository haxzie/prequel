import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Logo } from "@/components/Logo";
import { API_URL } from "@/lib/api";
import { absoluteUrl } from "@/lib/seo";
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

async function fetchShared(slug: string): Promise<Shared | null> {
  const response = await fetch(`${API_URL}/p/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) return null;
  return (await response.json()) as Shared;
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
  const shared = await fetchShared(slug);

  if (!shared) {
    return { title: "Recording not found", robots: { index: false, follow: false } };
  }

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
      ...(shared.poster ? { images: [{ url: shared.poster }] } : {}),
    },
    twitter: {
      card: "player",
      title: shared.title,
      ...(shared.poster ? { images: [shared.poster] } : {}),
    },
  };
}

export default async function SharedVideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shared = await fetchShared(slug);

  if (!shared) notFound();

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

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-medium tracking-tight text-fg">{shared.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {shared.teamName ? `Shared by ${shared.teamName}` : "Shared with Prequel"}
          </p>
        </div>

        <Link
          href="/"
          className="lit flex items-center gap-2 rounded-full border border-line bg-elevated px-4 py-2 text-sm text-fg transition-colors hover:border-muted/40"
        >
          <Logo size={18} />
          Made with Prequel
        </Link>
      </div>
    </div>
  );
}
