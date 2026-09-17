import { useEffect, useState } from "react";

import type { TeleprompterPosition, TeleprompterState } from "../../../shared/contract";
import { IDLE_TELEPROMPTER } from "../../../shared/contract";
import { follow } from "../lib/live";

/**
 * The prompter's rare state — script, pause, listening — pushed from main.
 *
 * The position is deliberately not in here: it changes several times a
 * second while someone reads, and a React state update per tick would
 * re-render every word in the script. See `useTeleprompterPosition`.
 */
export function useTeleprompter(): TeleprompterState {
  const [state, setState] = useState<TeleprompterState>(IDLE_TELEPROMPTER);

  useEffect(() => {
    return follow(
      () => window.prequel.teleprompter.state(),
      window.prequel.teleprompter.onChange,
      setState,
    );
  }, []);

  return state;
}

/**
 * Where the reader is, delivered to a callback rather than as state.
 *
 * Asks main for the first position once subscribed — `ready` is one-way, and
 * the answer arrives on the same channel as every later one, so the island
 * never has to reconcile a fetched value with a broadcast one.
 */
export function useTeleprompterPosition(listener: (position: TeleprompterPosition) => void): void {
  useEffect(() => {
    const unsubscribe = window.prequel.teleprompter.onPosition(listener);
    window.prequel.teleprompter.ready();
    return unsubscribe;
  }, [listener]);
}
