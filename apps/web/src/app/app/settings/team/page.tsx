import { TeamSettings } from "@/components/dashboard/TeamSettings";
import { pageMetadata } from "@/lib/seo";
import { requireTeam } from "@/lib/session";

export const metadata = pageMetadata({
  title: "Team",
  description: "Members and invitations.",
  path: "/app/settings/team",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { team } = await requireTeam();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-medium tracking-tight text-fg">{team.name}</h1>
      <p className="mt-1.5 text-sm text-muted">
        Everyone here can see the team&rsquo;s library and share into it.
      </p>

      {/* The member and invitation lists are read on the client through the
          organization plugin's own endpoints rather than proxied through a
          server component. Inviting and removing already have to happen there,
          and a server-rendered list beside them would be one render behind
          every action. */}
      <TeamSettings teamId={team.id} role={team.role} className="mt-8" />
    </div>
  );
}
