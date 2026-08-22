"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { authClient } from "@/lib/auth-client";

interface Details {
  organizationName: string;
  inviterEmail: string;
  email: string;
  status: string;
}

export function AcceptInvitation({
  invitationId,
  signedIn,
}: {
  invitationId: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [details, setDetails] = useState<Details | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "busy" | "gone">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const found = await authClient.organization.getInvitation({ query: { id: invitationId } });

      if (found.error || !found.data) {
        setState("gone");
        return;
      }

      setDetails(found.data as unknown as Details);
      setState("ready");
    })();
  }, [invitationId]);

  if (state === "loading") return <p className="text-sm text-muted">Loading invitation…</p>;

  if (state === "gone" || !details) {
    return (
      <>
        <h1 className="text-2xl font-medium tracking-tight text-fg">This invitation has expired</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Ask whoever invited you to send another one.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-medium tracking-tight text-fg">
        Join {details.organizationName}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {details.inviterEmail} invited <span className="text-fg">{details.email}</span> to their
        team on Prequel.
      </p>

      {signedIn ? (
        <Button
          className="mt-8"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy");
            setError(null);

            const accepted = await authClient.organization.acceptInvitation({ invitationId });

            if (accepted.error) {
              setState("ready");
              setError(accepted.error.message ?? "That didn't work.");
              return;
            }

            // Switched to the team just joined, or the dashboard opens on
            // whichever one the session happened to be pointed at.
            await authClient.organization.setActive({
              organizationId: accepted.data?.invitation.organizationId,
            });

            router.refresh();
            router.push("/app");
          }}
        >
          {state === "busy" ? "Joining…" : "Accept invitation"}
        </Button>
      ) : (
        <>
          {/* The `next` carries this page's path, so signing in comes straight
              back here with the token intact rather than landing on an empty
              dashboard the user has no team in. */}
          <Button
            className="mt-8"
            onClick={() => router.push(`/login?next=/invite/${invitationId}`)}
          >
            Sign in to accept
          </Button>
          <p className="mt-3 text-xs text-muted">
            Use {details.email} — the invitation is for that address.
          </p>
        </>
      )}

      {error ? (
        <p className="mt-4 text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
