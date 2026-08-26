/**
 * The grey shapes a dashboard page wears while its data is in flight.
 *
 * These exist for `loading.tsx`, and `loading.tsx` exists for prefetch. Next's
 * rule for a dynamic route is "partial prefetch to the nearest segment with a
 * `loading.js`" — so a route with no loading boundary prefetches *nothing*, and
 * every page under `/app` is `force-dynamic`. Without a file like this beside
 * each of them, a sidebar click waits on a full server render and two
 * round-trips to the Worker before a single pixel moves.
 *
 * Shapes mirror the real page rather than standing in for it with a spinner. A
 * spinner is less work and relays the page out the moment the data lands, which
 * is the jump this is meant to avoid.
 */
import type { ReactNode } from "react";

/** One placeholder. Sized by the caller; the animation lives on the wrapper. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded bg-white/8 ${className}`} />;
}

/**
 * Everything inside breathes on one clock.
 *
 * `animate-pulse` on each bar is the same effect on paper, but the bars mount at
 * slightly different times under streaming and drift out of phase, which reads
 * as noise rather than as loading. `motion-reduce` because Tailwind does not opt
 * its own animations out.
 */
export function SkeletonPage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      // Announced as busy rather than silently swapped in: a screen reader
      // otherwise gets a page of empty divs and no explanation for them.
      role="status"
      aria-label="Loading"
      className={`animate-pulse motion-reduce:animate-none ${className}`}
    >
      {children}
    </div>
  );
}
