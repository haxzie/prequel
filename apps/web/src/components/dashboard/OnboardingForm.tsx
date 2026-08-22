"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { authClient } from "@/lib/auth-client";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [invites, setInvites] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-8 flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);

        const created = await authClient.organization.create({ name, slug: slugify(name) });

        if (created.error || !created.data) {
          setBusy(false);
          setError(created.error?.message ?? "That team couldn't be created.");
          return;
        }

        const teamId = created.data.id;

        // Set before inviting, so the dashboard the user lands on is this team
        // rather than whichever the session had before. Without it a second team
        // created by an existing user opens showing the first one's library.
        await authClient.organization.setActive({ organizationId: teamId });

        // Invitations are best-effort. Somebody mistyping one address should not
        // lose the team they just made, and the team settings page can send the
        // rest — so a failure here is reported and not fatal.
        const failures: string[] = [];

        for (const email of addresses(invites)) {
          const sent = await authClient.organization.inviteMember({
            email,
            role: "member",
            organizationId: teamId,
          });
          if (sent.error) failures.push(email);
        }

        if (failures.length > 0) {
          setBusy(false);
          setError(`Team created, but we couldn't invite ${failures.join(", ")}.`);
          return;
        }

        // `refresh()` before navigating: the dashboard is a server component
        // that reads the session, and the router cache still holds the version
        // rendered when this user had no team.
        router.refresh();
        router.push("/app");
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-fg">Team name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={60}
          className="h-11 rounded-full border border-line bg-surface px-5 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-fg">
          Invite people <span className="font-normal text-muted">— optional</span>
        </span>
        <textarea
          value={invites}
          onChange={(event) => setInvites(event.target.value)}
          rows={3}
          placeholder="ana@example.com, sam@example.com"
          className="resize-none rounded-2xl border border-line bg-surface px-5 py-3 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <span className="text-xs text-muted">Separate addresses with commas or new lines.</span>
      </label>

      <Button type="submit" disabled={busy || name.trim().length === 0}>
        {busy ? "Creating…" : "Create team"}
      </Button>

      {error ? (
        <p className="text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * A URL-safe slug, with a random tail.
 *
 * The tail is not decoration: slugs are unique across every team on Prequel, and
 * "Acme" is a name several unrelated companies will pick. Without it the second
 * one to sign up gets a constraint violation on the only step of onboarding.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

  return `${base || "team"}-${Math.random().toString(36).slice(2, 7)}`;
}

function addresses(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("@"));
}
