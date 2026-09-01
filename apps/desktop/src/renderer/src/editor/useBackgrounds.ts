/**
 * The background catalogue, as the picker needs it.
 *
 * Three states rather than two, because "still loading" and "nothing hosted"
 * want different pictures on screen: a skeleton while the catalogue is being
 * fetched, the hosted list once it arrives, and the shipped presets if there
 * is neither a cache nor a network. The last is not an error state — a picker
 * that is empty on a train would be.
 *
 * Every fetch is main's. The renderer's CSP is
 * `connect-src 'self' prequel-media:`, so this could not reach the API even by
 * accident; it asks over IPC and reads pictures back through `prequel-media:`.
 */
import { useEffect, useMemo, useState } from "react";

import {
  BACKGROUND_CATEGORIES,
  BACKGROUND_CATEGORY_LABELS,
  BACKGROUND_PRESETS,
} from "../../../shared/backgrounds";
import type { BackgroundListing } from "../../../shared/contract";

export interface BackgroundGroup {
  id: string;
  label: string;
  items: BackgroundListing[];
}

export interface Backgrounds {
  groups: BackgroundGroup[];
  /** True until the first answer arrives, which is what draws the skeleton. */
  loading: boolean;
  /** True when these are the shipped presets rather than the hosted list. */
  shipped: boolean;
}

/**
 * The shipped presets in the same shape as the hosted ones.
 *
 * No blurhash and no sizes: these are already on disk, so nothing is ever drawn
 * as a placeholder for them. Wearing the same shape keeps the picker from
 * having two ways to draw a swatch.
 */
function fallback(): BackgroundGroup[] {
  return BACKGROUND_CATEGORIES.map((id) => ({
    id,
    label: BACKGROUND_CATEGORY_LABELS[id],
    items: BACKGROUND_PRESETS.filter((preset) => preset.category === id).map((preset) => ({
      id: preset.id,
      label: preset.label,
      category: preset.category,
      file: preset.file,
      md5: "",
      bytes: 0,
      width: 0,
      height: 0,
      blurhash: "",
      thumbnail: "",
      raw: "",
    })),
  }));
}

export function useBackgrounds(): Backgrounds {
  const [listings, setListings] = useState<BackgroundListing[] | null>(null);
  const [order, setOrder] = useState<{ id: string; label: string }[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void window.prequel.editor.backgrounds.catalogue().then((result) => {
      if (cancelled) return;

      if (result.ok && result.value) {
        setListings(result.value.backgrounds);
        setOrder(result.value.categories);
      }
      // A failure is not reported here. The catalogue is a nicety — main has
      // already logged why it could not be had — and the shipped pictures are
      // a working picker rather than an error worth interrupting an edit for.
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    if (!listings || !order) {
      return { groups: loading ? [] : fallback(), loading, shipped: !loading };
    }

    const groups = order
      .map((category) => ({
        id: category.id,
        label: category.label,
        items: listings.filter((listing) => listing.category === category.id),
      }))
      // A category the catalogue names but has no pictures in is a heading with
      // nothing under it, which is worse than no heading.
      .filter((group) => group.items.length > 0);

    return { groups, loading: false, shipped: false };
  }, [listings, order, loading]);
}
