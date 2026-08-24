"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Ties a dashboard session to the account behind it.
 *
 * The id is the one the API uses, which is the whole point: the desktop app's
 * events are filed under the same `user.id`, so somebody who records on their
 * Mac and then opens the library is one person rather than two. Using an email
 * or a session id here would break that quietly — the charts would still draw.
 *
 * A client component because `posthog-js` runs in the browser, and rendered from
 * the dashboard layout rather than the root one: the marketing site has no
 * session to identify, and calling this with nothing would only be noise.
 */
export function Analytics({
  userId,
  email,
  name,
  teamId,
}: {
  userId: string;
  email: string;
  name: string;
  teamId: string;
}) {
  useEffect(() => {
    // Cheap and idempotent — posthog-js short-circuits when the id has not
    // changed — so running it on every dashboard render costs nothing and means
    // switching teams is picked up without a reload.
    posthog.identify(userId, { email, name });
    posthog.group("team", teamId);
  }, [userId, email, name, teamId]);

  return null;
}
