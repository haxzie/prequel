"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/Button";

/**
 * A question that has to be answered before something is destroyed.
 *
 * Built on the native `<dialog>` rather than a positioned div. The element is
 * drawn in the browser's top layer, so it cannot be clipped by the dashboard's
 * scrolling column or trapped under a stacking context two ancestors up — and
 * focus trapping, inertness of the page behind it, and Escape all come with it
 * rather than being reimplemented, badly, per dialog.
 *
 * Not `window.confirm()`: that blocks the whole tab, cannot say which recording
 * it means, and has no way to show the failure if the delete then fails.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Disables both answers while the action is in flight. */
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // React state stays the single source of truth for whether this is open. The
  // element has its own idea of that, so the two are pushed into step here
  // rather than left to drift — a dialog closed by the browser while the state
  // still says open would refuse to reopen.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-elevated p-6 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onCancel={(event) => {
        // Escape. Prevented so the close goes through the same path every other
        // dismissal does, instead of the element closing itself behind React's
        // back.
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself; one on the
        // card inside lands on a child. That is the whole test.
        if (event.target === ref.current && !pending) onCancel();
      }}
    >
      <h2 id="confirm-title" className="text-base font-medium tracking-tight">
        {title}
      </h2>
      <div className="mt-2 text-sm leading-relaxed text-muted">{body}</div>

      {error ? (
        <p className="mt-4 text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="danger" size="sm" disabled={pending} onClick={onConfirm}>
          {pending ? "Deleting…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
