"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/Button";
import { api, ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";

import { Avatar, isOurPicture } from "./Avatar";
import { CropDialog } from "./CropDialog";

/**
 * The picture, and the two things that can be done to it.
 *
 * The picture shown is whatever the session says — a copy we hold, or the
 * marble — and after a change the page is refreshed rather than the state
 * patched, so the sidebar's copy of the same picture changes in the same
 * moment. Two avatars for one person on one screen is the bug that would
 * otherwise be visible for as long as the tab stays open.
 */
export function ProfilePicture({ user }: { user: SessionUser }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const has = isOurPicture(user.image);

  const upload = async (blob: Blob) => {
    setPending(true);
    setError(null);
    try {
      await api("/v1/me/avatar", {
        method: "PUT",
        body: blob,
        // `api()` assumes JSON for any body; this one is the picture.
        headers: { "content-type": blob.type },
      });
      setFile(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "That didn't save. Try again.");
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await api("/v1/me/avatar", { method: "DELETE" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "That didn't save. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-8 flex items-start gap-5 border-t border-line pt-6">
      <Avatar seed={user.email} image={user.image} size={72} />

      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium text-fg">Profile picture</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {has
            ? "Shown beside your name in the library and on every link you share."
            : "Without one you get a pattern of your own, which is the same everywhere you sign in."}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            {has ? "Change picture" : "Upload a picture"}
          </Button>
          {has && (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove}>
              Remove
            </Button>
          )}
        </div>

        {error && !file ? (
          <p className="mt-3 text-sm text-brand-from" role="alert">
            {error}
          </p>
        ) : null}

        {/* Hidden and driven by the button above: a bare file input cannot be
            styled as one of ours, and the picker it opens is the same. */}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
          className="hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            // Cleared so choosing the same file again still fires a change.
            event.target.value = "";
            setError(null);
            setFile(chosen);
          }}
        />
      </div>

      <CropDialog
        file={file}
        pending={pending}
        error={file ? error : null}
        onCrop={upload}
        onCancel={() => setFile(null)}
      />
    </section>
  );
}
