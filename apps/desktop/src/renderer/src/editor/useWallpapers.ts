/**
 * The styles and palettes the pattern picker offers.
 *
 * Two states rather than three, which is the difference from `useBackgrounds`:
 * a drawn background needs no bytes from anywhere, so there is nothing to wait
 * for and nothing to draw a skeleton over. The shipped list is live from the
 * first paint and the hosted one replaces it a moment later if it says
 * anything different.
 */
import { useEffect, useState } from "react";

import { wallpaperCatalogue, type WallpaperCatalogue } from "../../../shared/wallpapers";

export function useWallpapers(): WallpaperCatalogue {
  const [catalogue, setCatalogue] = useState<WallpaperCatalogue>(wallpaperCatalogue);

  useEffect(() => {
    let cancelled = false;

    void window.prequel.editor.wallpapers.catalogue().then((result) => {
      if (cancelled || !result.ok || !result.value) return;
      setCatalogue(result.value);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return catalogue;
}
