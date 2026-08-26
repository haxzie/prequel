import { useEffect } from "react";

import type { Entitlement } from "../../../shared/contract";
import { Wash } from "../components/Wash";
import { CloseIcon, ExportIcon, LinkIcon } from "./icons";

/**
 * What Export opens once the trial has run out.
 *
 * It stands in for the export dialog rather than sitting on top of it: an
 * upgrade prompt over a panel of frame rates invites the frame rates to be
 * fiddled with, and nothing on that panel can be acted on until this is.
 *
 * The wash across the top is the welcome window's, from the same component —
 * this is the second thing the app ever asks anybody for, and it should look
 * like it came from the same place as the first.
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
      className="no-drag absolute inset-0 z-50 grid place-items-center bg-black/50 p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={signedOut ? "Sign in to export" : "Upgrade to export"}
        className="relative isolate flex w-[380px] flex-col overflow-hidden rounded-2xl border border-editor-line bg-editor-panel shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        {/* Shorter than the welcome window's, which is sized to a full window.
            `-z-10` rather than a stacking order: the circles are absolutely
            positioned over the whole dialog, and without it they sit on top of
            the buttons and swallow the clicks. */}
        <Wash className="-z-10 h-40" />

        <div className="flex flex-col items-center px-7 pt-9 pb-7 text-center">
          {/* The export icon, not a padlock or a price tag. What is being asked
              for is the thing they just pressed, and the picture should be that
              rather than a threat. */}
          <span className="grid size-12 place-items-center rounded-2xl border border-white/12 bg-white/8 text-white [&_svg]:size-5">
            <ExportIcon />
          </span>

          <h2 className="mt-5 text-[1.0625rem] font-medium tracking-tight text-editor-fg">
            {signedOut ? "Sign in to keep exporting" : "Your trial has ended"}
          </h2>

          <p className="mt-2 text-[0.8125rem] leading-relaxed text-editor-muted">
            {signedOut
              ? "Exporting needs an account — the free trial runs for fourteen days from the day you sign up. Everything you have already exported stays on your Mac."
              : "The fourteen days are up. Upgrade to go on exporting at 4K and 120 fps, with no watermark and no limit on a take. Everything you have already exported stays on your Mac."}
          </p>

          <ul className="mt-5 flex w-full flex-col gap-2.5 text-left text-[0.8125rem] text-editor-muted">
            {PITCH.map((line) => (
              <li key={line} className="flex gap-2.5">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-white/40" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 border-t border-editor-line px-4 py-4">
          <button
            type="button"
            onClick={signedOut ? onSignIn : onUpgrade}
            className="sunrise relative isolate overflow-hidden rounded-lg py-2.5 text-center text-[12px] font-medium text-white transition-[filter] hover:brightness-110"
          >
            <span className="flex items-center justify-center gap-1.5 [&_svg]:size-3.5">
              {signedOut ? "Sign in" : "Upgrade"}
              <LinkIcon />
            </span>
          </button>

          {/* Says where the button goes before it goes there. A native app that
              throws a browser at you without warning reads as having lost the
              thread, and the answer to "why did Safari just open" should not
              have to be worked out afterwards. */}
          <p className="text-center text-[11px] text-editor-muted">
            {signedOut ? "Opens your browser to sign in" : "Opens prequel.sh in your browser"}
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] text-editor-muted hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5"
          >
            <CloseIcon />
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What the money buys, in three lines.
 *
 * The look first, because that is what the app is for and what the pricing page
 * leads on. A list of formats would describe a converter.
 */
const PITCH = [
  "Zooms that follow the work, tilted, with the focus falling away from the subject",
  "A camera framed after the take, over any background",
  "4K at up to 120 fps, no watermark, no limit on a take",
];
