/**
 * One background in the picker.
 *
 * Three layers, drawn in the order they can be had:
 *
 * 1. The BlurHash, decoded on the spot. It travels inside the catalogue, so it
 *    is available before any picture has been fetched — the swatch has colour
 *    from the first frame rather than being a grey box that pops.
 * 2. The thumbnail, once main has cached it. Twenty kilobytes against two
 *    megabytes for the picture it stands for.
 * 3. A spinner over the top while the full picture is being downloaded into the
 *    recording, which only happens to a swatch that has just been chosen.
 *
 * The thumbnail fades in over the hash rather than replacing it, so a slow
 * network is a picture sharpening rather than a swatch changing.
 */
import { useEffect, useState } from "react";

import type { BackgroundListing } from "../../../../shared/contract";
import { assetUrl, backgroundUrl } from "../../../../shared/media-url";
import { cn } from "../../lib/cn";
import { hashUrl } from "./blurhash";

export function BackgroundSwatch({
  listing,
  chosen,
  busy,
  cell,
  edge,
  chosenEdge,
  onChoose,
}: {
  listing: BackgroundListing;
  chosen: boolean;
  /** The full picture is being fetched for this one right now. */
  busy: boolean;
  cell: string;
  edge: string;
  chosenEdge: string;
  onChoose: () => void;
}) {
  // A shipped preset carries no thumbnail path — it is already on disk, and the
  // app's own copy is what the swatch shows.
  const hosted = listing.thumbnail !== "";
  const [thumbnail, setThumbnail] = useState<string | null>(hosted ? null : assetUrl(listing.file));

  useEffect(() => {
    if (!hosted) return;
    let cancelled = false;

    void window.prequel.editor.backgrounds.thumbnail(listing.file).then((result) => {
      if (cancelled || !result.ok || !result.value) return;
      setThumbnail(backgroundUrl(listing.file));
    });

    return () => {
      cancelled = true;
    };
  }, [hosted, listing.file]);

  const placeholder = hashUrl(listing.blurhash);

  return (
    <button
      type="button"
      title={listing.label}
      aria-label={listing.label}
      aria-pressed={chosen}
      aria-busy={busy}
      className={cn(CELL_BASE, cell, chosen ? chosenEdge : edge)}
      onClick={onChoose}
    >
      {placeholder && (
        <span
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${placeholder}")` }}
        />
      )}

      {thumbnail && (
        <span
          aria-hidden
          // Fades in over the hash rather than replacing it, so the swatch
          // sharpens instead of changing.
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-200"
          style={{ backgroundImage: `url("${thumbnail}")` }}
        />
      )}

      {busy && (
        <span aria-hidden className="absolute inset-0 grid place-items-center bg-black/45">
          <Spinner />
        </span>
      )}
    </button>
  );
}

const CELL_BASE = "relative overflow-hidden";

/**
 * A ring that turns.
 *
 * Exported because the scene preset cards show the same thing for the same
 * reason — a look whose wallpaper is being fetched.
 */
export function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 animate-spin text-white" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="3"
      />
      {/* A quarter of the circumference, which is what reads as motion. */}
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The grey box a swatch is before the catalogue has arrived. */
export function BackgroundSkeleton({ cell, edge }: { cell: string; edge: string }) {
  return <span aria-hidden className={cn(cell, edge, "animate-pulse bg-white/5")} />;
}
