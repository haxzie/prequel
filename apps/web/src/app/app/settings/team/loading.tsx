import { Skeleton, SkeletonPage } from "@/components/dashboard/Skeleton";

/** The team page: a heading, the invite row, then a member list. */
export default function TeamLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-2xl">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2.5 h-4 w-80" />

      <div className="mt-8 flex flex-col gap-10">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-10 flex-1 rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>

        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-1.5 h-3 w-56" />
              </div>
              <Skeleton className="h-3 w-14 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
