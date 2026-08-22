"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { api } from "@/lib/api";

export function VideoActions({
  id,
  title: initialTitle,
  url,
  className = "",
}: {
  id: string;
  title: string;
  url: string;
  className?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={`flex flex-col gap-5 ${className}`}>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            await api(`/v1/videos/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
            setSaved(true);
            window.setTimeout(() => setSaved(false), 1600);
            router.refresh();
          } catch {
            setError("That title didn't save.");
          }
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
          aria-label="Title"
          className="h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-5 text-sm text-fg focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="secondary" disabled={title === initialTitle}>
          {saved ? "Saved" : "Rename"}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-full border border-line bg-surface px-5 py-2.5 font-mono text-xs text-muted">
          {url}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg"
        >
          Open
        </a>
      </div>

      <div className="flex items-center gap-3">
        {confirming ? (
          <>
            <span className="text-sm text-muted">
              Delete this recording? The link stops working.
            </span>
            <button
              type="button"
              className="text-sm font-medium text-brand-from hover:underline"
              onClick={async () => {
                setError(null);
                try {
                  await api(`/v1/videos/${id}`, { method: "DELETE" });
                  router.push("/app");
                  router.refresh();
                } catch {
                  setError("That didn't delete.");
                  setConfirming(false);
                }
              }}
            >
              Delete
            </button>
            <button
              type="button"
              className="text-sm text-muted hover:text-fg"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          // Two presses rather than a `confirm()`. A native dialog in a page
          // like this blocks the whole tab, and the second press is the same
          // guard for none of that cost.
          <button
            type="button"
            className="text-sm text-muted hover:text-brand-from"
            onClick={() => setConfirming(true)}
          >
            Delete recording
          </button>
        )}
      </div>

      {error ? (
        <p className="text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
