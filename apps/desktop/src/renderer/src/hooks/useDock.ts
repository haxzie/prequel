import { useEffect, useState } from "react";

import type { DockState } from "../../../shared/contract";
import { DEFAULT_PREFERENCES, IDLE_SESSION } from "../../../shared/contract";

const INITIAL: DockState = {
  view: "setup",
  preferences: DEFAULT_PREFERENCES,
  selection: null,
  session: IDLE_SESSION,
  activeMode: null,
  selecting: false,
  cameraError: null,
  // Nothing is opened until main says the panel is up. Starting true would
  // grab the camera for one round trip on every window that renders this.
  devicesLive: false,
};

/**
 * Live panel state, pushed from the main process.
 *
 * Main is the single source of truth — the tray, the panel and the overlays all
 * render the same state, so none of them can drift from what is actually being
 * captured.
 */
export function useDock(): DockState {
  const [state, setState] = useState<DockState>(INITIAL);

  useEffect(() => {
    let live = true;
    void window.prequel.dock.state().then((initial) => {
      if (live) setState(initial);
    });

    const unsubscribe = window.prequel.dock.onChange(setState);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return state;
}
