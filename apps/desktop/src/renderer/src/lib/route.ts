import { useSyncExternalStore } from "react";

/**
 * Where this window is, as the hash says.
 *
 * Every window loads one bundle and picks its view from the hash — see `Root`.
 * That used to be read exactly once, because nothing ever changed it: main
 * pushed the screen instead, and a window stayed on the route it was opened
 * with for its whole life. The editor having a route of its own is what makes
 * the hash something that moves, and this is the one place that knows it.
 *
 * `hashchange` rather than the History API. The window is a `file://` document
 * in a packaged build, where `pushState` gives a URL that cannot be reloaded,
 * and reloading onto the current route is exactly what this design is for.
 */
export function currentRoute(): string {
  return window.location.hash.replace(/^#/, "") || "/dock";
}

/**
 * Goes to a route.
 *
 * Assigning the hash rather than calling `replace`, so the window keeps a
 * history: Back out of an editor, and the browser's own entry for the library
 * is what it lands on. Nothing in the app draws a back button from that history,
 * but the trackpad gesture and ⌘[ both use it, and a user who has them is
 * entitled to have them work.
 */
export function navigate(route: string): void {
  window.location.hash = route;
}

/**
 * The current route, as state.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect: the hash can
 * change between the first render and the effect that would subscribe to it —
 * main navigating a window that is still mounting is the ordinary case, not a
 * race worth ignoring — and this reads it at render time on every pass.
 */
export function useRoute(): string {
  return useSyncExternalStore(subscribe, currentRoute, currentRoute);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * The recording a route is for, or null if it is not an editor route.
 *
 * Decoded here, because the name is encoded on the way in: every recording is
 * called `Prequel <date> <time>` and the spaces would otherwise arrive as `%20`
 * in the window's title bar.
 */
export function recordingInRoute(route: string): string | null {
  const prefix = "/editor/";
  if (!route.startsWith(prefix)) return null;

  const name = route.slice(prefix.length);
  if (!name) return null;

  try {
    return decodeURIComponent(name);
  } catch {
    // A hash somebody typed, or one mangled on the way through a reload. Not a
    // recording, and not worth throwing over.
    return null;
  }
}
