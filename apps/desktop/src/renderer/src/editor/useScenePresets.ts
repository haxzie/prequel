/**
 * The looks the picker offers: the ones saved on this machine.
 *
 * Over IPC because the renderer can reach neither the network nor the disk.
 *
 * There was a published catalogue here too, fetched from a cache and refreshed
 * behind it. It has gone with the rest of the hosted half — a look is something
 * you make, and the list this returns is now only ever your own.
 *
 * A failure is swallowed on purpose, as `useBackgrounds` swallows one: what it
 * means here is a shorter list, and there is nothing the user could do about it
 * if they were told.
 */
import { useCallback, useEffect, useState } from "react";

import type { ScenePreset } from "../../../shared/scene-presets";

export function useScenePresets(): {
  mine: ScenePreset[];
  /** Replaces the saved list wholesale — every write answers with all of it. */
  setMine: (presets: ScenePreset[]) => void;
} {
  const [mine, setMine] = useState<ScenePreset[]>([]);

  useEffect(() => {
    let cancelled = false;

    void window.prequel.editor.scenePresets.list().then((result) => {
      if (!cancelled && result.ok) setMine(result.value);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { mine, setMine: useCallback((presets: ScenePreset[]) => setMine(presets), []) };
}
