import type { ReactNode } from "react";

import { Analytics } from "@/components/Analytics";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { requireTeam } from "@/lib/session";

/**
 * The dashboard's own chrome.
 *
 * `middleware.ts` has already turned away anyone with no cookie at all; this is
 * where a cookie that is present but no longer valid is caught, because only the
 * Worker can tell the two apart.
 *
 * A sidebar rather than a top bar. The nav is fixed and the library scrolls
 * under it, which is what a list you page through wants — and the account, the
 * team and the plan all need somewhere permanent to live that a single row of
 * links could not give them.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // The same guard the pages run. `getMe` is `cache()`d, so this is one request
  // to the Worker for the whole render rather than one per component.
  const { me, team } = await requireTeam();

  return (
    // `h-dvh` with the column scrolling inside it, rather than the page
    // scrolling: the sidebar has to stay put, and `position: fixed` on it would
    // take it out of flow and leave the main column to be padded around a width
    // defined somewhere else.
    <div className="flex h-dvh overflow-hidden bg-bg">
      <Analytics userId={me.user.id} email={me.user.email} name={me.user.name} teamId={team.id} />
      <Sidebar user={me.user} teams={me.teams} activeTeamId={team.id} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-10">{children}</div>
      </main>
    </div>
  );
}
