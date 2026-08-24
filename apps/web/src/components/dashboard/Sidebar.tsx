"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/Logo";
import { authClient } from "@/lib/auth-client";
import { displayName } from "@/lib/display-name";
import type { SessionUser, Team } from "@/lib/session";

import { Avatar } from "./Avatar";
import { STROKE } from "./icons";
import { Popover } from "./Popover";
import { UpgradeCard } from "./UpgradeCard";

const LINKS = [
  { href: "/app", label: "Library", Icon: LibraryIcon },
  { href: "/app/settings/team", label: "Team", Icon: TeamIcon },
  { href: "/app/settings/billing", label: "Billing", Icon: BillingIcon },
] as const;

export function Sidebar({
  user,
  teams,
  activeTeamId,
}: {
  user: SessionUser;
  teams: Team[];
  activeTeamId: string;
}) {
  const pathname = usePathname();
  const team = teams.find((one) => one.id === activeTeamId) ?? teams[0];

  return (
    // `--elevated` rather than `--surface`. Both are lighter than the page, but
    // `--surface` is four points off `--bg` and disappears on anything but a
    // good display — the panel has to be legible as a panel, not inferred from a
    // border. The library is a grid of dark video thumbnails, so the chrome
    // being the lighter plane is also what keeps the content in front of it.
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-elevated">
      <div className="flex items-center gap-2 p-3">
        <Link href="/app" className="shrink-0" aria-label="Prequel">
          <Logo size={26} />
        </Link>
        <TeamPicker teams={teams} activeTeamId={activeTeamId} />
      </div>

      <nav className="flex flex-col gap-0.5 px-3 py-2">
        {LINKS.map(({ href, label, Icon }) => {
          // `startsWith` would light Library up everywhere, since every
          // dashboard path begins with `/app`.
          const current = href === "/app" ? pathname === "/app" : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0 ${
                current ? "bg-white/8 text-fg" : "text-muted hover:bg-white/5 hover:text-fg"
              }`}
            >
              <Icon />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {team?.plan === "free" ? <UpgradeCard className="mx-3 mb-3" /> : null}

      <UserMenu user={user} />
    </aside>
  );
}

/**
 * Which team the dashboard is showing.
 *
 * A button and a popover rather than a `<select>`: the row carries an avatar and
 * a role, and a native select can hold only text. It also has to stay usable at
 * one team, where it is a label rather than a control.
 */
function TeamPicker({ teams, activeTeamId }: { teams: Team[]; activeTeamId: string }) {
  const [open, setOpen] = useState(false);
  const active = teams.find((one) => one.id === activeTeamId) ?? teams[0];

  if (!active) return null;

  if (teams.length === 1) {
    return <span className="min-w-0 truncate text-sm font-medium text-fg">{active.name}</span>;
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <span className="flex min-w-0 flex-1 items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-fg transition-colors hover:bg-white/8">
          <span className="min-w-0 truncate">{active.name}</span>
          <ChevronIcon />
        </span>
      }
    >
      {teams.map((one) => (
        <button
          key={one.id}
          type="button"
          role="menuitem"
          className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg hover:bg-white/8"
          onClick={async () => {
            if (one.id === activeTeamId) return setOpen(false);

            await authClient.organization.setActive({ organizationId: one.id });
            // A full reload rather than `router.refresh()`. The active team lives
            // on the session cookie and every server component on the page reads
            // it — a soft refresh re-renders them against a cookie the browser
            // has only just been handed.
            window.location.reload();
          }}
        >
          <span className="min-w-0 truncate">{one.name}</span>
          {one.id === activeTeamId ? <CheckIcon /> : null}
        </button>
      ))}
    </Popover>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const name = displayName(user.name, user.email);

  return (
    <div className="border-t border-line p-3">
      <Popover
        open={open}
        onOpenChange={setOpen}
        // Upwards: this sits at the bottom of the column, and a menu dropping
        // below it would open off the screen.
        placement="up"
        trigger={
          <span className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-white/8">
            <Avatar seed={user.email} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{name}</span>
              <span className="block truncate text-xs text-muted">{user.email}</span>
            </span>
          </span>
        }
      >
        <button
          type="button"
          role="menuitem"
          className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-fg hover:bg-white/8"
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/";
          }}
        >
          Sign out
        </button>
      </Popover>
    </div>
  );
}

/* Lucide geometry, inlined — the site draws its own icons and one dependency
   for four glyphs would leave two systems to keep in step. */
function LibraryIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <path d="m10 9 5 3-5 3z" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg {...STROKE} className="size-3.5 shrink-0 text-muted" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...STROKE} className="size-3.5 shrink-0 text-muted" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
