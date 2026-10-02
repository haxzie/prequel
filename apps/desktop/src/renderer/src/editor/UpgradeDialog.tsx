import { useEffect } from "react";

import type { Entitlement } from "../../../shared/contract";
import { ArrowRightIcon, CloseIcon } from "./icons";
import { UPGRADE_HEADER } from "./upgradeHeader";

/**
 * What Export opens once the trial has run out.
 *
 * It stands in for the export dialog rather than sitting on top of it: an
 * upgrade prompt over a panel of frame rates invites the frame rates to be
 * fiddled with, and nothing on that panel can be acted on until this is.
 *
 * A picture of the app across the top rather than the welcome window's wash.
 * This is the one moment the app asks for money, and the strongest argument it
 * has is a frame of what it makes — the wash is decoration, and decoration is
 * what you reach for when you have nothing to show.
 *
 * Everything already made stays made. The recording, the edit and every export
 * written during the trial are files on disk and are not touched by this; what
 * has lapsed is the ability to write another one. Saying so is not generosity,
 * it is the difference between a paywall and a hostage.
 */
export function UpgradeDialog({
  entitlement,
  onUpgrade,
  onSignIn,
  onClose,
}: {
  /** Only ever `expired` or `signed-out` — the two that cannot export. */
  entitlement: Entitlement;
  onUpgrade: () => void;
  /**
   * The app's own sign-in, not the billing page.
   *
   * Somebody signed out may still have days left; sending them to a payment
   * page to find that out would be charging for something they already have.
   * The PKCE flow comes back into this window, and the dialog gives way to the
   * export as soon as the entitlement lands.
   */
  onSignIn: () => void;
  onClose: () => void;
}) {
  const signedOut = entitlement.status === "signed-out";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    // `no-drag` throughout: this floats over the title bar's drag region, and
    // without it every press inside the header would move the window.
    <div
      className="no-drag absolute inset-0 z-50 grid place-items-center bg-black/60 p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={signedOut ? "Sign in to export" : "Upgrade to export"}
        className="relative isolate flex w-[420px] flex-col overflow-hidden rounded-[20px] bg-editor-panel shadow-[0_32px_80px_rgba(0,0,0,0.65)]"
      >
        {/* Bleeds to three edges, cut square against the body rather than faded
            into it. A gradient here would read as the picture being ashamed of
            where it stops. */}
        <div className="relative h-[262px] w-full overflow-hidden bg-black">
          <img
            src={UPGRADE_HEADER}
            alt=""
            // Held low in the frame rather than centred. The picture is wider
            // than this slot, so something is cropped either way — and what has
            // to survive is the lens, which is the whole reason this frame was
            // chosen over any other.
            className="size-full object-cover object-[50%_58%]"
            // Decorative: the heading underneath says what this is, and a
            // description of the screenshot would be read out in front of it.
            aria-hidden
          />

          {/* Over the picture, which is the only place for it — the body below
              is three centred things and a close button would make it four.
              The scrim is what keeps it legible over a screenshot that is
              light at one corner and dark at the other. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Not now"
            className="absolute top-3 right-3 grid size-7 place-items-center rounded-full bg-black/40 text-white/80 backdrop-blur transition-colors hover:bg-black/60 hover:text-white [&_svg]:size-3.5"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-col items-center px-8 pt-8 pb-7 text-center">
          <h2 className="text-[1.375rem] font-medium tracking-tight text-editor-fg">
            {signedOut ? "Sign in to keep exporting" : "Your free trial has ended"}
          </h2>

          {/* Two lines, and the copy is cut to fit them. Balanced as well, so
              neither line ends up carrying a single word — at this measure a
              third line reads as the dialog running on. */}
          <p className="mt-3 max-w-[21rem] text-[0.875rem] leading-relaxed text-balance text-editor-muted">
            {signedOut
              ? "Exporting needs an account. The free trial runs for seven days from the day you sign up."
              : "Upgrade to Pro or Lifetime to carry on exporting. Your exports stay on your Mac."}
          </p>

          <button
            type="button"
            onClick={signedOut ? onSignIn : onUpgrade}
            className="mt-7 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-white text-[0.9375rem] font-medium text-black transition-colors hover:bg-white/90 [&_svg]:size-4"
          >
            {signedOut ? "Sign in" : "Upgrade account"}
            <ArrowRightIcon />
          </button>

          {/* Says where the button goes before it goes there. A native app that
              throws a browser at you without warning reads as having lost the
              thread, and the answer to "why did Safari just open" should not
              have to be worked out afterwards. */}
          <p className="mt-3 text-[11px] text-editor-muted">
            {signedOut ? "Opens your browser to sign in" : "Opens prequel.sh in your browser"}
          </p>
        </div>
      </div>
    </div>
  );
}
