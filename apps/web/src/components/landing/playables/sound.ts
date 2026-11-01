"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How to stop whatever is sounding, wherever on the page it was started.
 *
 * The handle is the *card's* stop and not the audio element, which is the
 * whole of the bug it exists for: pausing another card's element leaves that
 * card's own state saying it is still playing, so the keyboard row kept its
 * stop button and its lit keys while the clicks card played over it. Two cards
 * cannot see each other's state, and this is the one thing they have to agree
 * on — a provider would exist only to pass it down.
 */
let stopSounding: (() => void) | undefined;

/**
 * Play one clip at a time, and say which it is.
 *
 * `new Audio` per press rather than one element with its `src` swapped:
 * changing `src` on a playing element is a load, and Safari keeps the old
 * buffer until the new one is ready — so a second press plays the first sound
 * again before it corrects itself.
 *
 * Nothing is preloaded. These are sixteen files and most visitors press none
 * of them, so the first press is what fetches; a four-second AAC clip is
 * roughly 40kB and arrives inside the press.
 */
export function useSound() {
  const [playing, setPlaying] = useState<string | undefined>();
  // The element this hook owns, so an unmount stops its own sound and not a
  // sibling card's, whatever has started since.
  const mine = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    mine.current?.pause();
    mine.current = null;
    if (stopSounding === stop) stopSounding = undefined;
    setPlaying(undefined);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const play = useCallback(
    (id: string, src: string) => {
      const wasPlaying = playing === id;
      stopSounding?.();
      if (wasPlaying) return;

      const audio = new Audio(src);
      audio.addEventListener("ended", () => setPlaying(undefined));
      // A file that 404s or a codec the browser will not take leaves the card
      // stuck mid-press otherwise, which reads as a broken button rather than
      // as a sound that did not arrive.
      audio.addEventListener("error", () => setPlaying(undefined));
      mine.current = audio;
      stopSounding = stop;
      setPlaying(id);
      void audio.play().catch(() => setPlaying(undefined));
    },
    [playing, stop],
  );

  return { playing, play, stop };
}
