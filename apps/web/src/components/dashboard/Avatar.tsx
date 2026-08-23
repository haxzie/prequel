"use client";

import BoringAvatar from "boring-avatars";

/**
 * Everyone's picture, generated rather than fetched.
 *
 * The provider's photo is deliberately never rendered, even when there is one.
 * It means no request leaves for a third-party CDN on every page that lists a
 * person, nothing to fall back from when that CDN is slow or the URL has gone
 * stale, and one visual language for accounts that have a photo and accounts
 * that never will — a magic-link user has no picture and never gets one.
 *
 * Seeded by the address, so the same person is the same marble on every device,
 * in the desktop app, and after every sign-in. An avatar that changes on refresh
 * is worse than no avatar.
 */
const PALETTE = ["#e14b15", "#ac1860", "#c000f0", "#4e84f9", "#eeacff"];

export function Avatar({
  seed,
  size = 32,
  className = "",
}: {
  /** What the marble is generated from. The email: stable, unique, and known. */
  seed: string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`block shrink-0 overflow-hidden rounded-full ${className}`}>
      <BoringAvatar size={size} name={seed} variant="marble" colors={PALETTE} />
    </span>
  );
}
