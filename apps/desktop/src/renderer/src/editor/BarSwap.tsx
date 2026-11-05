import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * One bar replaced by another, in the slot over the composition.
 *
 * The frame's bar, a picture's and the crop's are the same pill in the same
 * place showing a narrower subject each time, and swapping their contents on a
 * single frame read as a flicker — three controls of one width vanishing and
 * five of another appearing, with nothing to say they were the same object.
 * The outgoing one sinks and fades while the incoming one rises into its place.
 *
 * The leaving copy is kept on screen rather than animating only the arrival,
 * which is what makes it a swap rather than a pop: the old bar is held in a ref
 * and rendered one last time, absolutely positioned so the pill's width can
 * change underneath it. It is inert — `aria-hidden`, no pointer — because it is
 * a picture of a control that has already gone.
 */
export function BarSwap({ id, children }: { id: string; children: ReactNode }) {
  /**
   * The last committed bar.
   *
   * A ref written after the commit rather than state: it has to be fresh on
   * every render — the numbers in the bar change as a picture is dragged, and a
   * copy taken when the *id* last changed would fade out showing where the
   * picture used to be. Reading it during the swap render is reading the
   * previous commit, which is exactly the frame to leave behind.
   */
  const last = useRef<ReactNode>(children);
  const [current, setCurrent] = useState(id);
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode } | null>(null);

  // Adjusted during render rather than in an effect, which is React's own
  // pattern for state that follows a prop: an effect would commit the new bar
  // first and start the old one leaving a frame later, and the two would be on
  // screen at full strength for that frame.
  if (current !== id) {
    setLeaving({ id: current, node: last.current });
    setCurrent(id);
  }

  useEffect(() => {
    last.current = children;
  });

  return (
    <div className="relative flex flex-none items-center justify-center">
      {leaving && (
        <div
          key={leaving.id}
          aria-hidden
          className="animate-bar-out pointer-events-none absolute inset-0 flex items-center justify-center"
          onAnimationEnd={() => setLeaving(null)}
        >
          <div className="flex-none">{leaving.node}</div>
        </div>
      )}
      {/* Keyed, so each swap is a new element with its animation unplayed.
          Without it React updates the old one in place and nothing moves. */}
      <div key={id} className="animate-bar-in flex-none">
        {children}
      </div>
    </div>
  );
}
