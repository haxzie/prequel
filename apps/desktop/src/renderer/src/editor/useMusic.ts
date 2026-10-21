/**
 * The hosted music library, as the picker needs it.
 *
 * Fetched once per editor window and then held: the list is a few hundred
 * bytes and the picker is opened repeatedly while somebody tries songs.
 *
 * Every fetch is main's. The renderer's CSP is
 * `connect-src 'self' prequel-media:`, so this could not reach the API even by
 * accident; it asks over IPC and plays tracks back through `prequel-media:`.
 *
 * There is a floor under it, as there is under the backgrounds: the track the
 * app ships. A machine that has never been online still has one bed it can
 * lay, which is the difference between a feature that degrades and one that is
 * simply missing — and it is what keeps Add Ambient Music pressable offline.
 */
import { useEffect, useMemo, useState } from "react";

import type { MusicListing } from "../../../shared/contract";
import { SHIPPED_MUSIC } from "../../../shared/music";

export interface MusicGroup {
  id: string;
  label: string;
  items: MusicListing[];
}

export interface Music {
  groups: MusicGroup[];
  /** True until the first answer arrives, which is what draws the skeleton. */
  loading: boolean;
}

/**
 * The shipped track in the same shape as a hosted one.
 *
 * No md5 and no size: it is already on disk, so nothing ever checks either.
 * Wearing the catalogue's shape keeps the picker from having two ways to draw
 * a row. `raw` is empty for the same reason — main copies this one out of the
 * bundle rather than fetching it, which is `ensureMusic`'s first branch.
 */
function fallback(): MusicGroup[] {
  return [
    {
      id: "built-in",
      label: "Built in",
      items: SHIPPED_MUSIC.map((track) => ({
        id: track.id,
        label: track.label,
        category: "built-in",
        file: track.file,
        md5: "",
        bytes: 0,
        duration: track.duration,
        attribution: track.attribution,
        raw: "",
      })),
    },
  ];
}

export function useMusic(): Music {
  const [tracks, setTracks] = useState<MusicListing[] | null>(null);
  const [order, setOrder] = useState<{ id: string; label: string }[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void window.prequel.editor.music.catalogue().then((result) => {
      if (cancelled) return;

      if (result.ok && result.value) {
        setTracks(result.value.tracks);
        setOrder(result.value.categories);
      }
      // A failure is not reported here. Main has already logged why the
      // library could not be had, and a picker showing only what this
      // recording holds is a working picker rather than an error worth
      // interrupting an edit for.
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    // The shipped track while there is no catalogue, and nothing at all until
    // the first answer arrives — a picker that drew the floor and then swapped
    // it for the hosted list would flicker on every open.
    if (!tracks || !order) return { groups: loading ? [] : fallback(), loading };

    const groups = order
      .map((category) => ({
        id: category.id,
        label: category.label,
        items: tracks.filter((track) => track.category === category.id),
      }))
      // A category the catalogue names but has nothing in is a heading with
      // nothing under it, which is worse than no heading.
      .filter((group) => group.items.length > 0);

    return { groups, loading: false };
  }, [tracks, order, loading]);
}
