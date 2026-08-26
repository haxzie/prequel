import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import type { LibraryVideo } from "@/app/app/page";
import { formatBytes } from "@/lib/format";
import { VideoActions } from "@/components/dashboard/VideoActions";
import { VideoHeader } from "@/components/dashboard/VideoHeader";
import { API_URL } from "@/lib/api";
import { pageMetadata } from "@/lib/seo";
import { requireTeam } from "@/lib/session";
import { env } from "@prequel/env";

export const metadata = pageMetadata({
  title: "Recording",
  description: "Manage a shared recording.",
  path: "/app",
  robots: { index: false, follow: false },
});

/**
 * Dynamic, and now it has to be.
 *
 * `src` below is a presigned R2 URL with a six-hour life, the same as the public
 * share page's. A statically rendered copy of this page would hand everybody who
 * arrived after the build an expired signature, and the failure looks like a
 * video that will not play rather than like a stale cache.
 */
export const dynamic = "force-dynamic";

/** What `GET /v1/videos/:id/playback` answers with. */
interface Playback {
  src: string;
  contentType: string;
}

/**
 * One recording, from the owning team's side.
 *
 * Reads the library listing and picks the row out of it rather than calling a
 * per-video endpoint. The listing is already scoped to the team and capped at
 * 200, so this needs no new authorisation path — and a video the caller's team
 * does not own simply is not in the list, which is the correct answer anyway.
 *
 * The player's URL is the one thing that cannot come from the listing. A
 * signature is minted per request and expires, so two hundred of them per
 * library render would be two hundred HMACs for one video anybody watches — it
 * is fetched here instead, alongside the listing rather than after it.
 */
export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookie = (await cookies()).toString();

  // All three in parallel, the session guard included. Neither fetch needs
  // anything the guard produces — the Worker scopes both to the team off the
  // same cookie — so awaiting it first would put a whole round-trip to
  // Cloudflare in front of the two that do the work. An invalid cookie still
  // redirects, because `requireTeam` throws out of the `Promise.all` and the
  // calls it raced come back 401 and are discarded.
  const [, response, playing] = await Promise.all([
    requireTeam(),
    fetch(`${API_URL}/v1/videos`, { headers: { cookie }, cache: "no-store" }).catch(() => null),
    fetch(`${API_URL}/v1/videos/${encodeURIComponent(id)}/playback`, {
      headers: { cookie },
      cache: "no-store",
    }).catch(() => null),
  ]);

  if (!response?.ok) notFound();

  const { videos } = (await response.json()) as { videos: LibraryVideo[] };
  const video = videos.find((entry) => entry.id === id);
  if (!video) notFound();

  const playback = playing?.ok ? ((await playing.json()) as Playback) : null;

  const url = `${env.NEXT_PUBLIC_APP_URL}/v/${video.slug}`;

  return (
    <div className="mx-auto max-w-3xl">
      <VideoHeader id={video.id} title={video.title} className="mb-6" />

      <div className="overflow-hidden rounded-2xl border border-line bg-black">
        {playback === null ? (
          // The signature could not be minted — R2 credentials, or a Worker
          // being redeployed. The still is worth keeping for this: a page that
          // suddenly has no picture at all reads as the recording being gone,
          // where a frame of it with no controls reads as what it is.
          video.poster ? (
            <img src={video.poster} alt="" className="block aspect-video w-full object-cover" />
          ) : (
            <div className="aspect-video w-full bg-surface" />
          )
        ) : playback.contentType === "image/gif" ? (
          // A GIF is not a video, and a `<video>` pointed at one shows nothing at
          // all — no error, just a black rectangle with controls.
          <img src={playback.src} alt={video.title} className="block w-full" />
        ) : (
          <video
            src={playback.src}
            poster={video.poster ?? undefined}
            controls
            playsInline
            // `metadata` rather than `auto`, as on the share page: enough to draw
            // the scrubber and no more, so opening the library's detail page does
            // not pull a hundred megabytes down for somebody who came to copy the
            // link.
            preload="metadata"
            className="block max-h-[70dvh] w-full bg-black"
          />
        )}
      </div>

      <VideoActions url={url} className="mt-6" />

      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-line pt-6 text-sm sm:grid-cols-4">
        <Fact label="Shared by" value={video.ownerName ?? "Someone"} />
        <Fact
          label="Size"
          value={`${formatBytes(video.sizeBytes)}${video.width ? ` · ${video.width}×${video.height}` : ""}`}
        />
        <Fact label="Views" value={String(video.viewCount)} />
        <Fact
          label="Shared"
          value={new Date(video.createdAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}
        />
      </dl>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-fg">{value}</dd>
    </div>
  );
}
