import { LibraryGrid } from "@/components/dashboard/LibraryGrid";
import { API_URL } from "@/lib/api";
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
  const { team } = await requireTeam();
  const library = await fetchLibrary();

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
          {formatBytes(library.usage)} of {formatBytes(team.storageQuotaBytes)}
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

/**
 * Bytes, in the units a storage figure is read in.
 *
 * Base 1000 rather than 1024, to agree with what R2 bills and what macOS shows
 * for the same file. A library that reports less than the invoice is the sort of
 * discrepancy nobody can explain a year later.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
