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

export const dynamic = "force-dynamic";

/**
 * One recording, from the owning team's side.
 *
 * Reads the library listing and picks the row out of it rather than calling a
 * per-video endpoint. The listing is already scoped to the team and capped at
 * 200, so this needs no new authorisation path — and a video the caller's team
 * does not own simply is not in the list, which is the correct answer anyway.
 */
export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireTeam();

  const { id } = await params;
  const cookie = (await cookies()).toString();

  const response = await fetch(`${API_URL}/v1/videos`, {
    headers: { cookie },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) notFound();

  const { videos } = (await response.json()) as { videos: LibraryVideo[] };
  const video = videos.find((entry) => entry.id === id);
  if (!video) notFound();

  const url = `${env.NEXT_PUBLIC_APP_URL}/v/${video.slug}`;

  return (
    <div className="mx-auto max-w-3xl">
      <VideoHeader id={video.id} title={video.title} className="mb-6" />

      <div className="overflow-hidden rounded-2xl border border-line bg-black">
        {video.poster ? (
          <img src={video.poster} alt="" className="block aspect-video w-full object-cover" />
        ) : (
          <div className="aspect-video w-full bg-surface" />
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
