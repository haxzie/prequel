"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { api, ApiError } from "@/lib/api";
import { PRICE_MONTHLY } from "@/lib/pricing";

/**
 * What a free team sees when it tries to grow.
 *
 * Opened by the 402 the invite gate answers with, and by the billing page's own
 * Upgrade button. One component for both, because the words in front of the
 * price have to be the same in both places — a modal that explains seats
 * differently from the billing page is two descriptions of one product.
 *
 * Built on `<dialog>` for the reasons `ConfirmDialog` gives: top layer, focus
 * trap and Escape for free, and nothing an ancestor stacking context can clip.
 */
export function UpgradeDialog({
  open,
  canManage,
  onClose,
}: {
  open: boolean;
  /** An owner or admin. Only they can be sent to checkout. */
  canManage: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const upgrade = async () => {
    setPending(true);
    setError(null);

    try {
      const { url } = await api<{ url: string }>("/v1/billing/checkout", { method: "POST" });
      // A full navigation rather than a router push: the destination is Dodo's
      // host, and Next's router only knows about routes in this app.
      window.location.href = url;
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : "Couldn't start checkout. Try again.",
      );
      // Left pending on success, deliberately. The redirect is in flight and a
      // button that comes back to life invites a second checkout session.
      setPending(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="upgrade-title"
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-line bg-elevated p-6 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !pending) onClose();
      }}
    >
      <h2 id="upgrade-title" className="text-base font-medium tracking-tight">
        Upgrade to add teammates
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-muted">
        Prequel is {PRICE_MONTHLY} per seat per month. Your subscription includes one seat, and
        every teammate you add takes another — charged for the rest of your month when they join.
      </p>

      <ul className="mt-4 space-y-1.5 text-sm text-muted">
        <li>A shared library everyone on the team can reach.</li>
        <li>25&nbsp;GB of recordings per seat.</li>
        <li>A seat you free up stays yours until your next renewal.</li>
      </ul>

      {error ? (
        <p className="mt-4 text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}

      {!canManage ? (
        <p className="mt-4 text-sm text-muted">Ask an owner or admin of your team to upgrade.</p>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onClose}>
          Not now
        </Button>
        {canManage ? (
          <Button type="button" size="sm" disabled={pending} onClick={upgrade}>
            {pending ? "Opening checkout…" : "Upgrade"}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
