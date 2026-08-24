/**
 * How far along an update is, live.
 *
 * Two outputs rather than one, and the split is the whole point. Everything a
 * layout depends on — the status, the version, the notes — is React state.
 * The percentage is not: it arrives many times a second while a hundred
 * megabytes come down, and putting it through `useState` re-renders the window
 * and the release notes with it on every chunk. It is handed to the caller as a
 * subscription that writes straight to the DOM instead.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

import type { UpdateState } from "../../../shared/contract";
import { IDLE_UPDATE } from "../../../shared/contract";

/** The state, minus the part that moves too fast to render. */
export type UpdateShape = Omit<UpdateState, "percent">;

export interface Update {
  state: UpdateShape;
  /** The bar. Scaled on its own transform, so nothing is laid out again. */
  barRef: RefObject<HTMLDivElement | null>;
  /** The reading beside it. */
  labelRef: RefObject<HTMLSpanElement | null>;
}

export function useUpdate(): Update {
  const [state, setState] = useState<UpdateShape>(IDLE_UPDATE);

  const barRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const apply = (next: UpdateState) => {
      const { percent, ...shape } = next;

      // `transform`, never `width`: a width change is a layout change, and this
      // one would happen next to the text being read.
      if (barRef.current) barRef.current.style.transform = `scaleX(${percent / 100})`;
      if (labelRef.current) labelRef.current.textContent = `${percent}%`;

      // Re-render only when something a layout depends on actually moved.
      setState((previous) =>
        previous.status === shape.status &&
        previous.current === shape.current &&
        previous.version === shape.version &&
        previous.notes === shape.notes &&
        previous.message === shape.message
          ? previous
          : shape,
      );
    };

    void window.prequel.update.state().then(apply);
    return window.prequel.update.onChange(apply);
  }, []);

  return { state, barRef, labelRef };
}
