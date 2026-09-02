import { LibraryGrid } from "@/components/dashboard/LibraryGrid";
import { API_URL } from "@/lib/api";
import { formatBytes, formatQuota } from "@/lib/format";
import { pageMetadata } from "@/lib/seo";
import { requireTeam } from "@/lib/session";
import { cookies } from "next/headers";

export const metadata = pageMetadata({
  title: "Library",
  description: "Recordings your team has shared.",
  path: "/app",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

export interface LibraryVideo {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  viewCount: number;
  createdAt: string;
  /** A presigned R2 URL, minted by the API. Null if the share had no still. */
  poster: string | null;
  ownerName: string | null;
}

export default async function LibraryPage() {
  // Not `getMe()` plus a `!`. The layout's redirect does not stop this page from
  // rendering — Next runs the two in parallel — so the guard has to be here.
  //
  // Started together rather than one after the other. The listing needs nothing
  // from the session — the Worker scopes it to the team off the same cookie — so
  // awaiting the guard first spends two serial round-trips to Cloudflare on a
  // page that can spend one, and that pair was most of what made opening the
  // dashboard feel slow. A cookie that turns out to be invalid still redirects:
  // `requireTeam` throws, and the listing it raced simply comes back 401 and is
  // dropped.
  const [{ team }, library] = await Promise.all([requireTeam(), fetchLibrary()]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-fg">Library</h1>
          <p className="mt-1.5 text-sm text-muted">
            Everything {team.name} has shared. Links work for anyone you send them to.
          </p>
        </div>
        <p className="font-mono text-xs text-muted">
          {formatBytes(library.usage)} of {formatQuota(team.storageQuotaBytes)}
        </p>
      </div>

      <LibraryGrid videos={library.videos} className="mt-8" />
    </>
  );
}

async function fetchLibrary(): Promise<{ videos: LibraryVideo[]; usage: number }> {
  const cookie = (await cookies()).toString();

  const response = await fetch(`${API_URL}/v1/videos`, {
    headers: { cookie },
    cache: "no-store",
  }).catch(() => null);

  // An unreachable API renders an empty library rather than an error page. The
  // page is still useful — the nav, the team, the quota — and a 500 here would
  // hide all of it behind a transient failure.
  if (!response?.ok) return { videos: [], usage: 0 };
  return (await response.json()) as { videos: LibraryVideo[]; usage: number };
}
