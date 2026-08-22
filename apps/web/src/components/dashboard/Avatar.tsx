"use client";

import BoringAvatar from "boring-avatars";

/**
 * The palette the generated avatars draw from.
 *
 * The site's own accents rather than Boring Avatars' default set, which is a
 * bright pastel scheme that looks pasted on against this page. Seeded by the
 * address, so the same person is the same marble on every device and after every
 * sign-in — an avatar that changes on refresh is worse than a letter in a circle.
 */
const PALETTE = ["#e14b15", "#ac1860", "#c000f0", "#4e84f9", "#eeacff"];

export function Avatar({
  src,
  seed,
  size = 32,
  className = "",
}: {
  /** The provider's picture, when there is one. */
  src?: string | null;
  /** What the fallback is generated from. The email, so it is stable and unique. */
  seed: string;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      // Not `next/image`: the source is Google's avatar CDN, and adding a remote
      // host to next.config for one 32px picture buys an optimiser round-trip
      // and a config entry to keep in step with whatever the provider serves.
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span className={`block shrink-0 overflow-hidden rounded-full ${className}`}>
      <BoringAvatar size={size} name={seed} variant="marble" colors={PALETTE} />
    </span>
  );
}
