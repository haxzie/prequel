import { Skeleton, SkeletonPage } from "@/components/dashboard/Skeleton";

/**
 * One recording, before its playback URL has been minted.
 *
 * The player band is the whole page here, so it is drawn at the same 16:9 the
 * real one is capped to. A shorter placeholder would push the facts up the page
 * and then drop them back down.
 */
export default function VideoLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-3xl">
      {/* Back arrow, title, menu — the same three slots `VideoHeader` fills, so
          the row does not reshuffle when the recording arrives. */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <Skeleton className="size-7 shrink-0 rounded-lg" />
        <Skeleton className="h-6 min-w-0 flex-1" />
        <Skeleton className="size-7 shrink-0 rounded-lg" />
      </div>

      <div className="aspect-video w-full rounded-2xl border border-line bg-black" />

      <Skeleton className="mt-6 h-9 w-40 rounded-xl" />

      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-line pt-6 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-4 w-24" />
          </div>
        ))}
      </dl>
    </SkeletonPage>
  );
}
