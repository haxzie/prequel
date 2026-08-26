/**
 * Whether this Mac may export, live.
 *
 * Read once and then followed, like `useAuth` and for the same reason: the
 * answer changes while a browser is open somewhere else, and the change that
 * matters most — a payment going through — arrives minutes after the button was
 * pressed and from a different application.
 *
 * `check` is the deliberate one. It asks the server rather than reporting what
 * is cached, and it is what the Export button calls: that is the single moment
 * the answer matters, and it is a moment the user is already waiting through.
 */
import { useCallback, useEffect, useState } from "react";

import type { Entitlement } from "../../../shared/contract";

export function useLicence(): {
  entitlement: Entitlement;
  check: () => Promise<Entitlement>;
} {
  // Starts unknown rather than null. It is the honest answer before the first
  // reply lands, and it is the one status that lets an export through — a
  // window that has not heard back yet must not refuse anything.
  const [entitlement, setEntitlement] = useState<Entitlement>({ status: "unknown" });

  useEffect(() => {
    void window.prequel.licence.state().then(setEntitlement);
    return window.prequel.licence.onChange(setEntitlement);
  }, []);

  const check = useCallback(async () => {
    const fresh = await window.prequel.licence.check();
    setEntitlement(fresh);
    return fresh;
  }, []);

  return { entitlement, check };
}
