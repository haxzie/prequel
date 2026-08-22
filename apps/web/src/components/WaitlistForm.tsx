"use client";

import { useState } from "react";

import { api, ApiError } from "@/lib/api";
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
          // The API is a Worker on another origin, so this is a CORS request.
          // `api()` is what supplies the credentials mode; a bare fetch here
          // works for the waitlist, which needs no cookie, and would silently
          // stop working the moment this form needed one.
          await api("/v1/waitlist", { method: "POST", body: JSON.stringify({ email }) });
          setState({ status: "done" });
        } catch (error) {
          setState({
            status: "error",
            message:
              error instanceof ApiError
                ? error.message
                : "That didn't go through. Try again in a moment.",
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
