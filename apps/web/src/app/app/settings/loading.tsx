import { Skeleton, SkeletonPage } from "@/components/dashboard/Skeleton";

/** The account page: a heading, two facts, and the picture row. */
export default function AccountLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-2xl">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="mt-2.5 h-4 w-full max-w-md" />

      <div className="mt-8 grid grid-cols-[auto_1fr] gap-x-8 gap-y-3">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="mt-8 flex items-start gap-5 border-t border-line pt-6">
        <Skeleton className="size-[72px] rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-3 h-9 w-36 rounded-full" />
        </div>
      </div>
    </SkeletonPage>
  );
}
