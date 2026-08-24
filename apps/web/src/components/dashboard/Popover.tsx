"use client";

import { useEffect, type ReactNode } from "react";

/**
 * A small menu, dismissed by a click anywhere else or by Escape.
 *
 * The backdrop is a real element rather than a document listener, which would
 * also have to ignore the press that opened the menu — the fiddly half of doing
 * this without one.
 *
 * The class props exist because this is used both in the sidebar, where the
 * trigger fills its column, and over a library card, where it is a small button
 * in a corner. Dismissal is the part worth having once; how wide the thing is
 * was never the shared part.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  placement = "down",
  className = "relative min-w-0 flex-1",
  triggerClassName = "flex w-full min-w-0",
  menuClassName = "w-full min-w-52",
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  placement?: "up" | "down";
  /** The positioning context. Must establish one — the menu is absolute. */
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  /** Names the trigger for anyone who cannot see what is in it. */
  label?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <div className={className}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(event) => {
          // A card wraps this in a link. Without stopping here, opening the menu
          // also navigates to the recording.
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!open);
        }}
      >
        {trigger}
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden="true"
            tabIndex={-1}
            onClick={(event) => {
              event.preventDefault();
              onOpenChange(false);
            }}
          />
          <div
            role="menu"
            className={`absolute z-50 rounded-xl border border-line bg-elevated p-1.5 shadow-2xl ${
              placement === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
            } ${menuClassName}`}
          >
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}
