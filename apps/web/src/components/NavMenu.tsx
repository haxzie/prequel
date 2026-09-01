"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { NAV } from "@/lib/site";

import { ButtonLink } from "./Button";
import { AppleIcon, CloseIcon, MenuIcon } from "./icons";

/**
 * The header's row, folded into one button on a phone.
 *
 * Below `sm` there is not room for the sections, the repository and the
 * download at once — they used to be dropped one by one until only the wordmark
 * and "Sign in" were left, which is a header that has quietly stopped being
 * navigation. Everything that goes is in here instead.
 *
 * `stars` arrives as a node rather than being rendered here: `GitHubStars` is
 * an async server component that fetches the count on the server, and importing
 * it into a client file would pull the fetch, the token and an hour's cache
 * into the browser. Passed as a prop it stays server-rendered and this
 * component only decides where it sits.
 *
 * Not the dashboard's `Popover`, which is the same dismissal logic under a
 * `role="menu"`. That role promises menu items, and these are page links — a
 * screen reader announces "menu" and then reads links that are not menuitems.
 * A disclosure button and a plain panel is what this actually is.
 */
export function NavMenu({ stars }: { stars: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // Navigating does not unmount the header, so without this the panel is still
  // hanging open over the page the link went to.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Escape has no link to move focus for it, so the focus ring would be
      // left on a button that is no longer there.
      trigger.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative sm:hidden">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="nav-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className="grid size-9 cursor-pointer place-items-center rounded-full text-fg transition-colors hover:bg-white/8"
        onClick={() => setOpen(!open)}
      >
        {open ? <CloseIcon className="size-5" /> : <MenuIcon className="size-5" />}
      </button>

      {open ? (
        <>
          {/* A real element rather than a document listener, which would also
              have to ignore the press that opened the panel — the fiddly half
              of doing this without one. The same trick the dashboard's
              `Popover` uses, and the reason is worth having in both places. */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />

          <div
            id="nav-menu"
            className="absolute top-full right-0 z-50 mt-2 w-60 rounded-2xl border border-line bg-elevated p-2 shadow-2xl"
          >
            {/* A second `<nav>` in the same header, which the note beside the
                sign-in link rules out — except that only one of the two is ever
                in the accessibility tree: the row is `display: none` below
                `sm`, and this panel is not rendered at all above it. Without
                one here, a phone has no navigation landmark at all. */}
            <nav className="flex flex-col">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-xl px-3 py-2.5 text-sm text-fg transition-colors hover:bg-white/8"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="my-2 border-t border-line" />

            {/* The repository before the download, as in the row: the download
                is what the page is asking for and belongs where the eye
                finishes. */}
            <div className="[&>a]:w-full">{stars}</div>

            <ButtonLink href="/download" size="sm" className="mt-2 w-full">
              <AppleIcon className="-mt-0.5 size-4" />
              Download
            </ButtonLink>
          </div>
        </>
      ) : null}
    </div>
  );
}
