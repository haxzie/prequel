/**
 * The signed-in user, on the server.
 *
 * The session lives in a cookie the Worker set on `.prequel.sh`. A server
 * component cannot read a cross-origin cookie's contents — it is httpOnly and
 * signed — so it forwards the header and lets the Worker answer.
 *
 * `cache()` is what makes that affordable. A dashboard page reads the session in
 * its layout, in the page and in a couple of components, and without dedupe that
 * is four calls to Cloudflare for one render. React's per-request cache collapses
 * them into one.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { API_URL } from "./api.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro";
  storageQuotaBytes: number;
  role: string;
}

/**
 * Where the account stands on its fourteen days.
 *
 * Derived by the Worker — `apps/api/src/lib/trial.ts` says why the dashboard is
 * handed a verdict where the desktop app is handed facts. Nothing here rounds a
 * countdown of its own; a second rule would disagree with the app the first time
 * either changed, and the two are read side by side by the same person.
 */
export interface Trial {
  status: "paid" | "trial" | "expired";
  /** Whole days remaining, rounded up. Zero when paid, and zero once it has run out. */
  daysLeft: number;
  /** Epoch milliseconds. */
  endsAt: number;
}

export interface Device {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Me {
  user: SessionUser;
  teams: Team[];
  activeTeamId: string | null;
  /** Resolved against the active team, which is the one the dashboard renders. */
  trial: Trial;
  devices: Device[];
}

/**
 * Whoever the request belongs to, or null.
 *
 * Never throws. A signed-out visitor and an API that is briefly unreachable both
 * produce null, because every caller's next move is the same either way — send
 * them to `/login` — and a 500 on the marketing-adjacent dashboard would be a
 * worse outcome than a redirect.
 */
export const getMe = cache(async (): Promise<Me | null> => {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;

  try {
    const response = await fetch(`${API_URL}/v1/me`, {
      headers: { cookie },
      // Session state must never be served from a cache shared between users.
      cache: "no-store",
    });

    if (!response.ok) return null;

    const me = (await response.json()) as Partial<Me>;

    // Belt and braces against a payload that is 200 but not a session — the API
    // now 401s when the user row is missing, and this is what stops a future
    // regression there from surfacing as `me.user.name` throwing in a page.
    return me.user && me.teams ? (me as Me) : null;
  } catch {
    return null;
  }
});

/** The team the dashboard is showing, resolved the way the API resolves it. */
export function activeTeam(me: Me): Team | null {
  return me.teams.find((team) => team.id === me.activeTeamId) ?? me.teams[0] ?? null;
}

/**
 * The session and team every dashboard page needs, or a redirect.
 *
 * **A guard in the layout does not protect the page.** Next renders a layout and
 * its page in parallel, so `redirect()` in `app/layout.tsx` does not stop
 * `app/page.tsx` from running first — it throws on `team.name` and the user sees
 * a crash instead of the onboarding page they were being sent to. This is not
 * theoretical; it is exactly what happened.
 *
 * So the guard lives here and every page calls it. The layout calls it too, for
 * the sidebar. `getMe` is wrapped in React's `cache()`, so all of that is one
 * request to the Worker per render.
 *
 * Returning a non-null `team` is what removes the `!` from the call sites — and
 * the `!` was the thing quietly asserting a state the type system knew was
 * possible.
 */
export async function requireTeam(next?: string): Promise<{ me: Me; team: Team }> {
  const me = await getMe();

  // `next` carries where to come back to. Without it the desktop handoff sends
  // somebody to sign in and then drops them on the library, with the app still
  // waiting on a deep link that is never coming.
  if (!me) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");

  const team = activeTeam(me);
  if (!team) redirect("/onboarding");

  return { me, team };
}
