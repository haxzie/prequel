/**
 * What macOS currently allows, kept current while the window is open.
 *
 * Polled rather than pushed, which is unusual for this app and is the right
 * answer here: two of the four permissions are granted in System Settings
 * rather than in a prompt, so the change happens in another process entirely
 * and nothing tells us about it. Without this the user grants Screen Recording,
 * comes back, and finds the row still saying it is missing.
 *
 * The window is small and short-lived, so a poll every couple of seconds costs
 * nothing worth measuring — and it stops as soon as the window is hidden.
 */
import { useCallback, useEffect, useState } from "react";

import type { PermissionId, PermissionState } from "../../../shared/contract";

/** How often the list is re-read while the window is on screen. */
const POLL_MS = 2000;

export interface Permissions {
  /** Empty until the first read lands. */
  states: PermissionState[];
  granted: (id: PermissionId) => boolean;
  /** True once every permission is allowed. */
  all: boolean;
  request: (id: PermissionId) => Promise<void>;
}

export function usePermissions(): Permissions {
  const [states, setStates] = useState<PermissionState[]>([]);

  const refresh = useCallback(async () => {
    setStates(await window.prequel.permissions.list());
  }, []);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => {
      // Nothing can change while the window is hidden, and a timer that keeps
      // asking is a timer that keeps waking the main process for no answer.
      if (document.hidden) return;
      void refresh();
    }, POLL_MS);

    // Coming back to the window is the moment a trip to System Settings ends,
    // so it is worth a read that does not wait for the next tick.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return {
    states,
    granted: (id) => states.find((state) => state.id === id)?.granted ?? false,
    // `length > 0` as well, or an empty list before the first read would
    // announce that everything is allowed.
    all: states.length > 0 && states.every((state) => state.granted),
    // The answer comes back from the request itself rather than from the next
    // poll, so a camera prompt that is accepted ticks its row immediately.
    request: async (id) => setStates(await window.prequel.permissions.request(id)),
  };
}
