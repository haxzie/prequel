"use client";

import { useState } from "react";

import { Button } from "./Button";

type State = { status: "idle" | "sending" | "done" } | { status: "error"; message: string };

export function WaitlistForm({ className = "" }: { className?: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  if (state.status === "done") {
    return (
      <p
        className={`flex h-11 items-center justify-center rounded-full border border-line bg-surface px-6 text-sm text-fg ${className}`}
        role="status"
      >
        You&rsquo;re on the list. We&rsquo;ll write when there&rsquo;s a build to try.
      </p>
    );
  }

  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get("email");
        setState({ status: "sending" });

        try {
          const response = await fetch("/api/waitlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
          });

          // The route answers with a message on every failure path, but a proxy
          // or a network fault can still return something that is not JSON.
          // Reading it defensively keeps a 502 from surfacing as a parse error.
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            const message =
              body && typeof body === "object" && "message" in body
                ? String((body as { message: unknown }).message)
                : "That didn't go through. Try again in a moment.";
            setState({ status: "error", message });
            return;
          }

          setState({ status: "done" });
        } catch {
          setState({
            status: "error",
            message: "Couldn't reach the server. Check your connection.",
          });
        }
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          // `text-left` pinned rather than inherited: an address is read
          // character by character, and this form now sits inside a centred hero.
          className="h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-5 text-left text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <Button type="submit" disabled={state.status === "sending"}>
          {state.status === "sending" ? "Joining…" : "Join the waitlist"}
        </Button>
      </div>

      {state.status === "error" ? (
        <p className="mt-2.5 text-sm text-brand-from" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
