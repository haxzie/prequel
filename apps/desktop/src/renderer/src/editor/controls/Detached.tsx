import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/cn";
import { FLOATING } from "../surfaces";

/**
 * A panel that opens *beside* the inspector rather than inside it.
 *
 * The three pickers this is for — a colour, a font, a keyboard's sound — were
 * lists that pushed the panel's own content down to make room for themselves.
 * That is the cheap way to do it and it has one real cost: choosing a colour
 * moves everything under the colour field by two hundred pixels, so the control
 * you were about to adjust next is somewhere else by the time you have finished
 * with this one. A list long enough to be worth opening is long enough to shove
 * the rest of the panel off the bottom of the window.
 *
 * Detached, the panel stays where it is and the list arrives next to it.
 *
 * **It has to be a portal, and for two reasons that are easy to miss.** The
 * inspector is `overflow-hidden` around a scrolling column, so anything
 * floating out of it is clipped at its edge. And the inspector carries a
 * `backdrop-filter`, which makes it a containing block for `position: fixed`
 * descendants — the same rule `filter` and `transform` follow — so even fixed
 * positioning would be trapped inside it. Both of those are invisible at
 * authoring time and obvious the moment you try it; the frame picker lost its
 * click-away overlay to the second one this afternoon.
 *
 * Positioned against the anchor and written straight to the element, never
 * through state: this follows scroll, and a `setState` per scroll event would
 * re-render the inspector to move one box.
 */

/** How far the panel sits from the thing it belongs to. */
const GAP = 8;

/** How close it may come to the window's edge before it is pushed back. */
const MARGIN = 8;

interface Slot {
  /** Which panel is open, or null. One at a time, by construction. */
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

const DetachedContext = createContext<Slot>({ openId: null, setOpenId: () => undefined });

/**
 * Holds which of these is open.
 *
 * One at a time, and that is the whole reason this is a context rather than a
 * `useState` in each picker. Three of them a few rows apart, each able to be
 * open at once, is three overlapping panels covering the composition — and
 * opening one while another is up is the ordinary way to move between them, so
 * it has to be the thing that closes the first.
 */
export function DetachedProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <DetachedContext.Provider value={{ openId, setOpenId }}>{children}</DetachedContext.Provider>
  );
}

/**
 * One picker's share of that: whether it is the open one, and how to say so.
 *
 * The id is generated rather than passed in. Nothing outside needs to name
 * these, and an id somebody has to invent is an id two controls will eventually
 * share — at which point opening one silently opens the other.
 */
export function useDetached(): {
  id: string;
  open: boolean;
  toggle: () => void;
  close: () => void;
} {
  const id = useId();
  const { openId, setOpenId } = useContext(DetachedContext);

  return {
    id,
    open: openId === id,
    toggle: () => setOpenId(openId === id ? null : id),
    close: () => setOpenId(null),
  };
}

export function Detached({
  anchor,
  open,
  label,
  onClose,
  children,
}: {
  /** The row this belongs to, which is what it is placed against. */
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  /** Named for the reader: this is a dialog with no title of its own. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  /**
   * Puts the panel beside its anchor, and keeps it there.
   *
   * To the left, because these live in the inspector and the inspector is
   * against the right-hand edge of the window — there is no room on the other
   * side, and a panel that flipped sides depending on space would move under
   * the hand as the window is resized.
   *
   * Clamped so it cannot run off the top or the bottom. A font list is taller
   * than a short window, and a panel anchored to a row near the foot of a long
   * inspector would otherwise hang below the timeline.
   */
  const place = useCallback(() => {
    const target = anchor.current;
    const element = panel.current;
    if (!target || !element) return;

    const rect = target.getBoundingClientRect();
    const height = element.offsetHeight;

    const top = Math.min(
      Math.max(MARGIN, rect.top),
      Math.max(MARGIN, window.innerHeight - height - MARGIN),
    );

    element.style.top = `${String(Math.round(top))}px`;
    element.style.left = `${String(Math.round(Math.max(MARGIN, rect.left - GAP)))}px`;
  }, [anchor]);

  // Before paint, or the panel is drawn at the origin for a frame and flies to
  // its place — which reads as it having come from the top left of the window.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    // `capture`, because what scrolls is the inspector's own column rather than
    // the document, and a scroll inside an element does not bubble.
    const follow = () => place();
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);

    const away = (event: Event) => {
      const node = event.target as Node;
      if (panel.current?.contains(node) || anchor.current?.contains(node)) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);

    return () => {
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open, place, onClose, anchor]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      // `-translate-x-full` so `left` can be the anchor's left edge and the
      // panel hangs off it. Laying it out from its own right edge would mean
      // measuring its width before it has one.
      className={cn(
        "fixed z-50 max-h-[70vh] w-60 -translate-x-full overflow-y-auto rounded-xl p-1",
        "sleek-scrollbar animate-tooltip-in",
        FLOATING,
      )}
      style={{ boxShadow: "0 12px 36px rgba(0,0,0,0.5)" }}
    >
      {children}
    </div>,
    document.body,
  );
}
