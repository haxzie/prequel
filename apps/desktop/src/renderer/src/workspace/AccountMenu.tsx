import { useEffect, useRef, useState } from "react";

import type { Entitlement } from "../../../shared/contract";
import { Avatar } from "../components/Avatar";
import { useAuth } from "../hooks/useAuth";
import { useLicence } from "../hooks/useLicence";
import { cn } from "../lib/cn";
import { AccountIcon } from "../settings/icons";

/**
 * Who is signed in, at the foot of the sidebar.
 *
 * A row rather than a pane of its own. Who you are is not a setting — it is not
 * changed, it is reported — and giving it a tab beside Projects and Settings
 * meant a screen you visit once and a question you actually want answered at a
 * glance: is this signed in, and as whom.
 *
 * The things you *can* do to an account are behind a press, because there are
 * two of them and neither is wanted often. Billing opens the browser and
 * signing out is not something to put a bare button under.
 */
export function AccountMenu() {
  const auth = useAuth();
  const { entitlement } = useLicence();

  return (
    <div className="no-drag flex flex-col gap-2">
      {upgradeable(entitlement) && <UpgradeCard entitlement={entitlement} />}
      {auth.status === "signed-in" ? (
        <Account account={auth.account} />
      ) : (
        <SignIn waiting={auth.status === "waiting"} />
      )}
    </div>
  );
}

/**
 * Whether there is anything to sell to this account.
 *
 * `unknown` is deliberately not upgradeable. It means signed in and never
 * successfully checked — offline on a first run — and a paying customer shown
 * an upgrade card because their network was down would be right to be annoyed.
 * `signed-out` has the sign-in button to make its point already.
 */
function upgradeable(entitlement: Entitlement): boolean {
  return entitlement.status === "trial" || entitlement.status === "expired";
}

/**
 * The nudge, above the account.
 *
 * States what is true rather than what is wanted from the reader — how long is
 * left, or that nothing is — because the trial is generous and a card that
 * only says "Upgrade" reads as an advert in an app somebody is working in.
 */
function UpgradeCard({ entitlement }: { entitlement: Entitlement }) {
  const ending = entitlement.status === "expired";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/12 bg-white/8 p-2.5">
      <div>
        <p className="text-[12px] font-medium text-editor-fg">
          {ending
            ? "Trial ended"
            : entitlement.status === "trial"
              ? `${String(entitlement.daysLeft)} ${entitlement.daysLeft === 1 ? "day" : "days"} left`
              : "Free trial"}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-editor-fg/65">
          {ending ? "Upgrade to keep exporting." : "Upgrade for unlimited exports."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void window.prequel.licence.upgrade()}
        className="rounded-md bg-selected px-2.5 py-1.5 text-[12px] font-medium text-white hover:brightness-110"
      >
        Upgrade
      </button>
    </div>
  );
}

function SignIn({ waiting }: { waiting: boolean }) {
  return (
    <button
      type="button"
      disabled={waiting}
      onClick={() => void window.prequel.auth.signIn()}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        waiting ? "text-editor-fg/50" : "text-editor-fg/70 hover:bg-white/8 hover:text-editor-fg",
      )}
    >
      <AccountIcon />
      {/* The browser is open and the app is waiting on a person in it, which
          can take as long as they take and can end in nothing at all. Saying so
          is the difference between a button that did nothing and one that did. */}
      {waiting ? "Waiting for your browser…" : "Sign in"}
    </button>
  );
}

function Account({
  account,
}: {
  account: { name: string; email: string; teamName: string | null };
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Dismissed the two ways a menu is expected to be: a press anywhere else, and
  // Escape. `pointerdown` rather than `click` so it closes on the press that
  // starts an interaction elsewhere rather than on the release.
  useEffect(() => {
    if (!open) return;

    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      {open && (
        // Above the row rather than below it: the row is already at the bottom
        // of the window, and a menu hung under it would open off-screen.
        //
        // `no-drag` on the menu itself, not merely on the container it belongs
        // to. `bottom-full` lifts it *out* of that container's box and onto the
        // sidebar, which is the window's drag region — so without this every
        // item is a strip of titlebar, and pressing Billing or Sign out moves
        // the window instead of doing anything. It fails silently and only for
        // the part of the menu that overhangs, which is all of it whenever
        // there is no upgrade card underneath to overhang onto.
        <div
          role="menu"
          className="no-drag absolute bottom-full left-0 z-10 mb-1 w-full overflow-hidden rounded-lg border border-editor-line bg-editor-panel py-1 shadow-lg"
        >
          {account.teamName && (
            <p className="truncate px-3 pt-1 pb-1.5 text-[11px] text-editor-muted">
              Sharing to {account.teamName}
            </p>
          )}
          <MenuItem
            label="Billing"
            onClick={() => {
              setOpen(false);
              void window.prequel.licence.upgrade();
            }}
          />
          <MenuItem
            label="Sign out"
            onClick={() => {
              setOpen(false);
              void window.prequel.auth.signOut();
            }}
          />
        </div>
      )}

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((showing) => !showing)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
          open ? "bg-white/8" : "hover:bg-white/5",
        )}
      >
        <Avatar seed={account.email} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-editor-fg">
            {account.name || account.email}
          </span>
          <span className="block truncate text-[11px] text-editor-muted">{account.email}</span>
        </span>
      </button>
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-[12px] text-editor-fg hover:bg-white/8"
    >
      {label}
    </button>
  );
}
