/**
 * Who is signed in, live.
 *
 * Read once and then followed, rather than polled: main broadcasts on every
 * change, and the change that matters most — a sign-in completing — arrives
 * minutes after the button was pressed and from a different application.
 */
import { useEffect, useState } from "react";

import { follow } from "../lib/live";

import type { AuthState } from "../../../shared/contract";

export function useAuth(): AuthState {
  // Starts signed-out rather than null, so nothing has to render a third
  // "unknown" state for the millisecond before the first answer lands.
  const [state, setState] = useState<AuthState>({ status: "signed-out" });

  useEffect(() => {
    return follow(() => window.prequel.auth.state(), window.prequel.auth.onChange, setState);
  }, []);

  return state;
}
