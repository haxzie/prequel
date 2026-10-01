import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * A list that takes over the panel, rather than one that opens inside or beside
 * it.
 *
 * The colour, the font and the two sound lists have been three things in a day.
 * In the flow they pushed every control below them down the panel, so the thing
 * you were about to reach for next had moved by the time you finished with this
 * one. Floating beside the panel fixed that and bought a different problem: a
 * second surface hanging off the window with no title and no way out but a
 * press in the right empty place.
 *
 * This is the shape the panel already had an answer for. The filter options and
 * the caption editor both take the whole panel over and put a back arrow in the
 * header, and a reader who has used either knows what has happened and how to
 * leave. These are the same thing — a long list that deserves the room — so
 * they are now the same gesture.
 *
 * The content is **portalled into a slot the panel renders**, not handed over as
 * a value. A list is built from the props and state of the control that owns it:
 * which font is chosen, what the colour is mid-drag, whether a sound is playing.
 * Lifting that into context would mean re-pushing the view on every keystroke to
 * keep it current, and a stale closure the one time it was forgotten. Portalled,
 * the control stays mounted where it is and only its output moves.
 */

interface Pushed {
  /** Which control has taken the panel over, or null. One at a time. */
  id: string | null;
  title: string;
  open: (id: string, title: string) => void;
  close: () => void;
  /** Where the panel wants the content. Null until the panel has rendered it. */
  slot: HTMLElement | null;
  setSlot: (element: HTMLElement | null) => void;
}

const PushedContext = createContext<Pushed>({
  id: null,
  title: "",
  open: () => undefined,
  close: () => undefined,
  slot: null,
  setSlot: () => undefined,
});

export function PushedProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ id: string | null; title: string }>({
    id: null,
    title: "",
  });
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const open = useCallback((id: string, title: string) => {
    setState({ id, title });
  }, []);
  const close = useCallback(() => {
    setState({ id: null, title: "" });
  }, []);

  const value = useMemo(
    () => ({ id: state.id, title: state.title, open, close, slot, setSlot }),
    [state, open, close, slot],
  );

  return <PushedContext.Provider value={value}>{children}</PushedContext.Provider>;
}

/**
 * What the panel needs to know: whether one of these is showing, and what to
 * call it.
 *
 * Read by the inspector to swap its header and its body. Everything else uses
 * `usePushed`.
 */
export function usePushedView(): Pick<Pushed, "id" | "title" | "close" | "setSlot"> {
  const { id, title, close, setSlot } = useContext(PushedContext);
  return { id, title, close, setSlot };
}

/**
 * One control's share of it.
 *
 * The id is generated rather than passed in. Nothing outside needs to name
 * these, and an id somebody has to invent is an id two controls will eventually
 * share — at which point opening one silently opens the other.
 */
export function usePushed(title: string): {
  open: boolean;
  toggle: () => void;
  close: () => void;
} {
  const id = useId();
  const { id: openId, open, close } = useContext(PushedContext);
  const mine = openId === id;

  return {
    open: mine,
    toggle: () => (mine ? close() : open(id, title)),
    close,
  };
}

/**
 * The list itself, drawn into the panel's slot.
 *
 * Renders nothing until the panel has given it somewhere to go — on the first
 * open the slot does not exist yet, because the panel only draws it once
 * something has asked for it. One frame, and then it is there.
 */
export function PushedView({ open, children }: { open: boolean; children: ReactNode }) {
  const { slot } = useContext(PushedContext);
  if (!open || !slot) return null;
  return createPortal(children, slot);
}
