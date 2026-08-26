import { Skeleton, SkeletonPage } from "@/components/dashboard/Skeleton";

/**
 * The library, before the Worker has answered.
 *
 * Six cards rather than a number read from anywhere: the count is exactly what
 * this file cannot know, and six fills the first screen at every breakpoint the
 * grid has.
 */
export default function LibraryLoading() {
  return (
    <SkeletonPage>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2.5 h-4 w-72" />
        </div>
        <Skeleton className="h-3.5 w-28" />
      </div>

      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="rounded-2xl border border-line bg-elevated">
            <div className="aspect-video w-full rounded-t-2xl bg-white/6" />
            <div className="flex flex-col gap-3 p-4">
              <div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonPage>
  );
}
