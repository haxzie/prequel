"use client";

import { useEffect, useState } from "react";

import { relativeDay } from "@/lib/format";

/**
 * How old the newest release is, for the hero's badge.
 *
 * A client component for one reason: the home page is static, so a relative
 * date rendered on the server is frozen at the moment of the build. The badge
 * would read "Today" for as long as that deploy is live, and a recency signal
 * that is wrong is worse than none — so the string is recomputed once on mount,
 * against the visitor's own clock.
 *
 * The server's answer is still the initial state, rather than nothing or the
 * ISO string: it is right on the day of the deploy and close for days after, so
 * the badge arrives complete and the correction is invisible. Rendering
 * something different on each side is a hydration mismatch, which React logs
 * and then patches up by trusting the client anyway.
 */
export function ReleaseAge({ date }: { date: string }) {
  const [age, setAge] = useState(() => relativeDay(date));

  useEffect(() => setAge(relativeDay(date)), [date]);

  return (
    <time dateTime={date} className="shrink-0 tabular-nums">
      {age}
    </time>
  );
}
