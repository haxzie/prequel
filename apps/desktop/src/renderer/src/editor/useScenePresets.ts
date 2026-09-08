/**
 * The looks the picker offers: ours, and the ones saved on this machine.
 *
 * Both come over IPC because the renderer can reach neither the network nor the
 * disk. Ours arrive from a cache first and a refresh behind it, so the menu
 * draws at once — a picker that waits on the network to show anything is a
 * picker that is empty on a train.
 *
 * Failures are swallowed on purpose, as `useBackgrounds` swallows them: what a
 * failed catalogue means here is a shorter list, and there is nothing the user
 * could do about it if they were told.
 */
import { useCallback, useEffect, useState } from "react";

import type { ScenePreset } from "../../../shared/scene-presets";

export function useScenePresets(): {
  ours: ScenePreset[];
  mine: ScenePreset[];
  /** Replaces the saved list wholesale — every write answers with all of it. */
  setMine: (presets: ScenePreset[]) => void;
} {
  const [ours, setOurs] = useState<ScenePreset[]>([]);
  const [mine, setMine] = useState<ScenePreset[]>([]);

  useEffect(() => {
    let cancelled = false;

    void window.prequel.editor.scenePresets.list().then((result) => {
      if (!cancelled && result.ok) setMine(result.value);
    });

    void window.prequel.editor.scenePresets.catalogue().then((result) => {
      if (!cancelled && result.ok) setOurs(result.value);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { ours, mine, setMine: useCallback((presets: ScenePreset[]) => setMine(presets), []) };
}
