"use client";

import Link from "next/link";
import { useState } from "react";

import type { LibraryVideo } from "@/app/app/page";
import { env } from "@prequel/env";

export function LibraryGrid({
  videos,
  className = "",
}: {
  videos: LibraryVideo[];
  className?: string;
}) {
  if (videos.length === 0) {
    return (
      <div
        className={`rounded-3xl border border-dashed border-line px-8 py-16 text-center ${className}`}
      >
        <p className="text-sm font-medium text-fg">Nothing shared yet</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Export a recording in Prequel and press <span className="text-fg">Share Link</span>. It
          lands here, and the link works for anyone.
        </p>
      </div>
    );
  }

  return (
    <ul className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {videos.map((video) => (
        <li key={video.id}>
          <Card video={video} />
        </li>
      ))}
    </ul>
  );
}

function Card({ video }: { video: LibraryVideo }) {
  const [copied, setCopied] = useState(false);
  const url = `${env.NEXT_PUBLIC_APP_URL}/v/${video.slug}`;

  return (
    <div className="lit group flex flex-col overflow-hidden rounded-2xl border border-line bg-elevated transition-colors hover:border-muted/40">
      <Link href={`/app/v/${video.id}`} className="block">
        {/* A fixed 16:9 band with the poster cropped into it, not the video's
            own aspect. A grid of cards at whatever shape each recording happens
            to be reads as broken rather than as varied. */}
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {video.poster ? (
            <img
              src={video.poster}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="size-full bg-surface" />
          )}
          {video.durationMs > 0 ? (
            <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white">
              {formatDuration(video.durationMs)}
            </span>
          ) : null}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <Link href={`/app/v/${video.id}`} className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{video.title}</p>
          <p className="mt-1 text-xs text-muted">
            {video.ownerName ?? "Someone"} · {formatDate(video.createdAt)}
            {video.viewCount > 0
              ? ` · ${video.viewCount} view${video.viewCount === 1 ? "" : "s"}`
              : ""}
          </p>
        </Link>

        <button
          type="button"
          className="mt-auto self-start rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-muted/40 hover:text-fg"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * `UTC` pinned rather than left to the browser.
 *
 * This string is also rendered on the server for the first paint, and a
 * timezone difference between the two is a hydration mismatch that React
 * reports as an error in the console on every card.
 */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
