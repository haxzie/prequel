"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";

import { ConfirmDialog } from "./ConfirmDialog";
import { BackIcon, PencilIcon, TrashIcon } from "./icons";

/**
 * The recording's name, and the two things you can do to the recording itself.
 *
 * The title is the heading rather than a labelled field halfway down the page.
 * It is what the page is *about*, and a rename is a rare enough act that it does
 * not need a permanent text box — a pencil beside the name says the same thing
 * and leaves the heading reading as a heading the rest of the time.
 */
export function VideoHeader({
  id,
  title: initialTitle,
  className = "",
}: {
  id: string;
  title: string;
  className?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === title) {
      setEditing(false);
      setDraft(title);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api(`/v1/videos/${id}`, { method: "PATCH", body: JSON.stringify({ title: next }) });
      setTitle(next);
      setEditing(false);
      router.refresh();
    } catch {
      setError("That title didn't save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-4">
        {/* A link to the library rather than `router.back()`. Back is wherever
            the user happened to come from, which for a page reachable by its own
            URL is as often nowhere — and "up to the list" is the one answer that
            is right every time. */}
        <Link
          href="/app"
          aria-label="Back to library"
          title="Back to library"
          className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-white/8 hover:text-fg [&_svg]:size-4"
        >
          <BackIcon />
        </Link>

        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // Escape abandons the edit rather than saving it, which is what
                // every other text field on the machine does.
                setDraft(title);
                setEditing(false);
              }}
              // The point of pressing the pencil is to type, so the caret is put
              // where the user was already going.
              autoFocus
              required
              maxLength={200}
              aria-label="Title"
              disabled={saving}
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-xl font-medium tracking-tight text-fg focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={saving}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-fg hover:bg-white/8 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-60"
              onClick={() => {
                setDraft(title);
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="min-w-0 truncate text-xl font-medium tracking-tight text-fg">{title}</h1>
            <button
              type="button"
              aria-label="Rename"
              title="Rename"
              className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-white/8 hover:text-fg [&_svg]:size-4"
              onClick={() => {
                setDraft(title);
                setEditing(true);
              }}
            >
              <PencilIcon />
            </button>
          </div>
        )}

        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-white/8 hover:text-brand-from [&_svg]:size-4"
          onClick={() => {
            setDeleteError(null);
            setConfirming(true);
          }}
        >
          <TrashIcon />
          Delete
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Delete this recording?"
        body={
          <>
            <span className="text-fg">{title}</span> will be removed and its share link will stop
            working for anyone you have sent it to. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        pending={deleting}
        error={deleteError}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setDeleting(true);
          setDeleteError(null);
          try {
            await api(`/v1/videos/${id}`, { method: "DELETE" });
            // Pushed before the refresh: this page is about a recording that no
            // longer exists, and refreshing it in place would render its own
            // not-found.
            router.push("/app");
            router.refresh();
          } catch {
            setDeleteError("That didn't delete. Try again.");
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
