"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { LoginForm } from "@/components/dashboard/LoginForm";

/**
 * Signing in without leaving the recording.
 *
 * A share link is opened to watch something, and the moment somebody is asked
 * to sign in they are halfway through doing something else — typing a comment,
 * or reaching for an emoji. Sending them to `/login` and back loses the page
 * position, the playhead and whatever they had typed; a dialog over the player
 * loses none of it, and Google's redirect returns to this URL rather than to
 * the dashboard.
 *
 * `<dialog>` rather than a div with a high `z-index`: the top layer is above
 * every stacking context on the page including a full-screen video, Escape
 * closes it without a key handler, and the focus trap is the browser's.
 */
export function SignInDialog({
  open,
  reason,
  onClose,
}: {
  open: boolean;
  /** What they were trying to do, in their words. "comment", "react". */
  reason: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    // `showModal` throws if it is already open, which it is on every re-render
    // while the dialog is up.
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      // The backdrop is styled in `globals.css`'s `::backdrop` block; the
      // margin auto is what centres a `<dialog>`, which is positioned by the
      // browser rather than by flexbox.
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-bg p-6 text-fg backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onClose={onClose}
      // A click on the dialog's own box is a click on the backdrop as far as
      // the event target is concerned, so the test is where it landed rather
      // than what it hit.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-fg"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>

      <h2 className="text-lg font-medium tracking-tight">Sign in to {reason}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Watching needs no account. Leaving something behind does, so the person who shared this
        knows who said it.
      </p>

      {/* Back to this recording, not to the dashboard. `next` is read by the
          form to build the callback URL, and a share page is where somebody
          signing in from a share page expects to land. */}
      <LoginForm next={typeof window === "undefined" ? "/" : window.location.pathname} />
    </dialog>
  );
}
