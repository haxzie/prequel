"use client";

import BoringAvatar from "boring-avatars";
import { useState } from "react";

import { API_URL } from "@/lib/api";

/**
 * Everyone's picture: their own when we hold a copy, a marble otherwise.
 *
 * The provider's photo is still never fetched from the provider. What is drawn
 * is a copy the API serves from its own storage — made at sign-up, or uploaded
 * from the account page — so no request leaves for a third-party CDN on every
 * page that lists a person, and a URL that has gone stale at Google is not one
 * this ever sees. A `user.image` on any other host is treated as no picture,
 * which is what it is until the copy has been made.
 *
 * The marble is seeded by the address, so the same person is the same marble
 * on every device, in the desktop app, and after every sign-in. An avatar that
 * changes on refresh is worse than no avatar — and so is one that flickers
 * between a photo and a marble, which is why a photo that fails to load falls
 * back once and stays there.
 */
const PALETTE = ["#e14b15", "#ac1860", "#c000f0", "#4e84f9", "#eeacff"];

/** Whether an image URL is one the API serves, as opposed to a provider's. */
export function isOurPicture(image: string | null | undefined): image is string {
  return typeof image === "string" && image.startsWith(`${API_URL}/p/avatar/`);
}

export function Avatar({
  seed,
  image,
  size = 32,
  className = "",
}: {
  /** What the marble is generated from. The email where known; any stable string otherwise. */
  seed: string;
  /** `user.image`. Drawn only when it is one of ours. */
  image?: string | null;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const picture = !broken && isOurPicture(image) ? image : null;

  return (
    <span
      className={`block shrink-0 overflow-hidden rounded-full ${className}`}
      style={{ width: size, height: size }}
    >
      {picture ? (
        <img
          src={picture}
          alt=""
          width={size}
          height={size}
          className="block size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <BoringAvatar size={size} name={seed} variant="marble" colors={PALETTE} />
      )}
    </span>
  );
}
