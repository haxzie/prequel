"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { authClient } from "@/lib/auth-client";

/**
 * Which button is busy, not whether *a* button is busy.
 *
 * One shared flag made pressing Google put the magic-link button into
 * "Sending…" — an email nobody asked for, apparently on its way, while the
 * browser was in fact redirecting to Google.
 */
type Busy = "none" | "google" | "link";

/**
 * The two ways in.
 *
 * Neither is a signup. Both create the account on first use, which is why there
 * is no second form anywhere and no "already have an account?" line — the
 * question never comes up.
 */
export function LoginForm({ next }: { next: string }) {
  const [busy, setBusy] = useState<Busy>("none");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  if (sent) {
    return (
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6" role="status">
        <p className="text-sm font-medium text-fg">Check your email</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          We sent a link to <span className="text-fg">{sent}</span>. It works once and expires in
          ten minutes.
        </p>
        <button
          type="button"
          className="mt-4 text-sm text-muted underline underline-offset-4 hover:text-fg"
          onClick={() => setSent(null)}
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-5">
      <Button
        variant="secondary"
        disabled={busy !== "none"}
        onClick={async () => {
          setBusy("google");
          setError(null);

          // Anything after this line only runs when it *failed* — a successful
          // social sign-in navigates the page away.
          const result = await authClient.signIn.social({
            provider: "google",
            callbackURL: `${window.location.origin}${next}`,
          });

          if (result.error) {
            setBusy("none");
            setError(result.error.message ?? "Google sign-in didn't work.");
          }
        }}
      >
        <GoogleMark />
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const email = String(new FormData(event.currentTarget).get("email") ?? "");
          setBusy("link");
          setError(null);

          const result = await authClient.signIn.magicLink({
            email,
            callbackURL: `${window.location.origin}${next}`,
          });

          setBusy("none");

          if (result.error) {
            setError(result.error.message ?? "That link didn't send.");
            return;
          }

          setSent(email);
        }}
      >
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          className="h-11 rounded-full border border-line bg-surface px-5 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <Button type="submit" disabled={busy !== "none"}>
          {busy === "link" ? "Sending…" : "Email me a link"}
        </Button>
      </form>

      {error ? (
        <p className="text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Google's mark, which their brand terms require be their colours rather than
 * `currentColor` — a monochrome version of this is the one thing they ask for
 * it not to be.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.6-5.2 3.6-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.4v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.4 14.3a7.1 7.1 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.4 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z"
      />
    </svg>
  );
}
