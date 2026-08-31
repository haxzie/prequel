"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { authClient } from "@/lib/auth-client";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
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

        // Set so the dashboard the user lands on is this team rather than
        // whatever the session pointed at before — a sign-in that arrived
        // before the team existed carries no active organization at all.
        await authClient.organization.setActive({ organizationId: created.data.id });

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
 *
 * A retry therefore never collides with the attempt before it — which mattered
 * when a failure here left a team row behind holding the slug.
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
