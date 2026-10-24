"use client";

import { useState } from "react";

import { api, ApiError } from "@/lib/api";

/**
 * What we are allowed to send.
 *
 * **One switch, because there is one stream of email to switch.** Sign-in
 * links and the mail about a recording somebody shared are the account working
 * — they are sent the moment they are asked for and there is nothing to opt out
 * of. Product news is the only thing that arrives unprompted, so a second row
 * here would be a control that does nothing, which is worse than not offering
 * it.
 *
 * The switch moves before the request finishes and rolls back if it fails.
 * Waiting on a round trip to Cloudflare and then to Mails makes a checkbox feel
 * broken, and the only wrong state this can leave is one the error line names.
 */
export function EmailNotifications({ marketing }: { marketing: boolean }) {
  const [on, setOn] = useState(marketing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: boolean) => {
    const previous = on;
    setOn(next);
    setPending(true);
    setError(null);

    try {
      await api("/v1/me/emails", { method: "PUT", body: JSON.stringify({ marketing: next }) });
    } catch (cause) {
      setOn(previous);
      setError(cause instanceof ApiError ? cause.message : "That didn't save. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="text-sm font-medium text-fg">Email</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Sign-in links and the mail about a recording someone shared with you are always sent — they
        are the account working.
      </p>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm text-fg">Product news and tips</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">
            What is new in the app, and the occasional note on getting more out of it. A few times a
            month at most.
          </p>
        </div>

        {/* A button with `role="switch"` rather than a checkbox: a checkbox
            cannot be styled as a track and a knob without hiding the real input
            and rebuilding its keyboard behaviour, which is the whole of what
            this already has. */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Product news and tips"
          disabled={pending}
          onClick={() => void change(!on)}
          className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full border border-line transition-colors disabled:opacity-60 ${
            on ? "bg-fg" : "bg-transparent"
          }`}
        >
          <span
            className={`absolute top-0.5 size-4 rounded-full transition-[left] ${
              on ? "left-[1.125rem] bg-bg" : "left-0.5 bg-muted"
            }`}
          />
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
