"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/Button";

import { Avatar } from "./Avatar";
import { UpgradeDialog } from "./UpgradeDialog";
import { authClient } from "@/lib/auth-client";
import { displayName } from "@/lib/display-name";

interface Member {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
}

interface Invitation {
  id: string;
  email: string;
  role: string | null;
  status: string;
}

/** Only these two may invite or remove. The plugin enforces it server-side too. */
const CAN_MANAGE = new Set(["owner", "admin"]);

/**
 * The team has no subscription, so it cannot grow.
 *
 * 402 rather than 403, and the difference is the whole interaction: 403 is a
 * refusal to show the user, 402 is a price to show them. Anything else here
 * falls through to the error line.
 */
const NEEDS_UPGRADE = 402;

export function TeamSettings({
  teamId,
  role,
  className = "",
}: {
  teamId: string;
  role: string;
  className?: string;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const manage = CAN_MANAGE.has(role);

  const load = async () => {
    const full = await authClient.organization.getFullOrganization({
      query: { organizationId: teamId },
    });

    setMembers((full.data?.members ?? []) as Member[]);
    setInvitations(
      ((full.data?.invitations ?? []) as Invitation[]).filter((one) => one.status === "pending"),
    );
    setLoading(false);
  };

  // Keyed on `teamId` alone. `load` is redefined every render, so listing it
  // would refetch the whole team on each one — and the switcher reloads the page
  // outright, so in practice this fires once.
  useEffect(() => {
    void load();
  }, [teamId]);

  return (
    <div className={`flex flex-col gap-10 ${className}`}>
      <UpgradeDialog open={upgrading} canManage={manage} onClose={() => setUpgrading(false)} />

      {manage ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);

            const sent = await authClient.organization.inviteMember({
              email,
              role: "member",
              organizationId: teamId,
            });

            setBusy(false);

            if (sent.error) {
              // The seat gate. The invitation was never created, so there is
              // nothing to undo — the form keeps the address it was given, and
              // the same submission works once the team is on Pro.
              if (sent.error.status === NEEDS_UPGRADE) {
                setUpgrading(true);
                return;
              }

              setError(sent.error.message ?? "That invitation didn't send.");
              return;
            }

            setEmail("");
            await load();
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder="teammate@example.com"
            aria-label="Invite by email"
            className="h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-5 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Invite"}
          </Button>
        </form>
      ) : null}

      {error ? (
        <p className="text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}

      <section>
        <h2 className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Members</h2>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {loading ? (
            <li className="py-4 text-sm text-muted">Loading…</li>
          ) : (
            members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-4">
                <Avatar seed={member.user.email} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    {displayName(member.user.name, member.user.email)}
                  </p>
                  <p className="truncate text-xs text-muted">{member.user.email}</p>
                </div>
                <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[11px] text-muted uppercase">
                  {member.role}
                </span>
                {/* An owner cannot be removed from the interface. Removing the
                    last one leaves a team with a library and nobody able to
                    invite anyone back into it. */}
                {manage && member.role !== "owner" ? (
                  <button
                    type="button"
                    className="text-xs text-muted hover:text-brand-from"
                    onClick={async () => {
                      await authClient.organization.removeMember({
                        memberIdOrEmail: member.id,
                        organizationId: teamId,
                      });
                      await load();
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>

      {invitations.length > 0 ? (
        <section>
          <h2 className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Pending</h2>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center gap-4 py-4">
                <p className="min-w-0 flex-1 truncate text-sm text-muted">{invitation.email}</p>
                {manage ? (
                  <button
                    type="button"
                    className="text-xs text-muted hover:text-brand-from"
                    onClick={async () => {
                      await authClient.organization.cancelInvitation({
                        invitationId: invitation.id,
                      });
                      await load();
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
