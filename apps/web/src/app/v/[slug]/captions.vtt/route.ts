import type { NextRequest } from "next/server";

import { API_URL } from "@/lib/api";

/**
 * The subtitle track, through the site's own origin.
 *
 * The API serves the file at `/p/:slug/captions.vtt` and the player could
 * point a `<track>` straight at it — except that a cross-origin track only
 * loads with `crossorigin` set on the `<video>`, and that attribute governs
 * the *video's* fetch too. The picture is a presigned R2 URL, which answers no
 * CORS headers at all, and a `<video crossorigin>` pointed at one shows a
 * black rectangle with no error anywhere. Fetching the track from here keeps
 * it same-origin and leaves the video element alone.
 *
 * Nothing is cached on this side: the API's own `cache-control` is passed
 * through and the browser honours it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  const upstream = await fetch(`${API_URL}/p/${encodeURIComponent(slug)}/captions.vtt`, {
    cache: "no-store",
  }).catch(() => null);

  if (!upstream?.ok) return new Response(null, { status: upstream?.status ?? 502 });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/vtt; charset=utf-8",
      "cache-control": upstream.headers.get("cache-control") ?? "public, max-age=3600",
    },
  });
}
