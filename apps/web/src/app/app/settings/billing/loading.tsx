import { Skeleton, SkeletonPage } from "@/components/dashboard/Skeleton";

/** The billing page: a heading, the plan panel, and the note under it. */
export default function BillingLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-2xl">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="mt-2.5 h-4 w-full max-w-md" />
      <Skeleton className="mt-1.5 h-4 w-2/3" />

      <div className="mt-8 rounded-2xl border border-line bg-elevated p-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-6 w-40" />
        <Skeleton className="mt-4 h-4 w-3/4" />
        <Skeleton className="mt-6 h-9 w-36 rounded-xl" />
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-3.5 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </div>
    </SkeletonPage>
  );
}
