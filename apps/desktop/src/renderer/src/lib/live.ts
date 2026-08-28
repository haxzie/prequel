/**
 * Following a value that main owns.
 *
 * Every window does the same two things to learn some piece of main's state:
 * ask for it once, and subscribe for the changes after that. Doing both is not
 * optional — asking alone goes stale, subscribing alone leaves the window blank
 * until something happens to change — and the order they are combined in is
 * where the bug lives.
 *
 * The request is answered with the state as of when main *handled* it, not as
 * of when the answer arrives. So a change broadcast in that gap is newer than
 * the reply chasing it, and applying the reply afterwards puts the older value
 * back. Nothing fires again to correct it, because the thing that would have
 * fired already did.
 *
 * That is not theoretical: it stranded the update window on "Checking for
 * updates…" for ever, and it did so most reliably on the newest version, where
 * the check comes back in a second or two with nothing to install and never
 * says anything again. An update that *does* exist keeps emitting — available,
 * then progress — so the next event covered the clobbered one up and the bug
 * looked like it only happened to people with nothing to download.
 */

/**
 * Primes from `request`, then follows `subscribe`, newest value winning.
 *
 * Returns the cleanup for an effect: it unsubscribes, and it stops a reply that
 * is still in flight from landing on an unmounted window.
 */
export function follow<T>(
  request: () => Promise<T>,
  subscribe: (listener: (value: T) => void) => () => void,
  apply: (value: T) => void,
): () => void {
  let broadcast = false;
  let live = true;

  // Subscribed before the request goes out, so nothing that happens while it is
  // in flight is missed.
  const unsubscribe = subscribe((value) => {
    broadcast = true;
    if (live) apply(value);
  });

  void request().then(
    (initial) => {
      // The two guards answer different questions: `live` is "is anyone still
      // looking at this", `broadcast` is "has something better already arrived".
      if (live && !broadcast) apply(initial);
    },
    () => {
      // A failed prime leaves whatever the caller started with, which is a
      // window that has not heard yet rather than one showing something wrong.
    },
  );

  return () => {
    live = false;
    unsubscribe();
  };
}
