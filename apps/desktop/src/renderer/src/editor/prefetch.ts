/**
 * Fetches the editor's chunk before anybody asks for it.
 *
 * The editor is 784 KB of source against the library's 60, and it is a
 * `lazy()` chunk precisely so that the window that is up for the whole life of
 * the app does not parse it. The cost of that is paid at the click: the route
 * changes, and the first thing the user gets is `Opening…` for as long as
 * fetching and parsing takes.
 *
 * Nobody opens the library to look at the library. Warming the chunk while it
 * is on screen spends idle time on the one thing the user is almost certainly
 * about to do, and by the time they click there is nothing left to load but the
 * recording itself.
 *
 * Idempotent, and cheap to call twice: a dynamic import of a module already in
 * flight returns the same promise, so the second call is a lookup rather than a
 * second fetch.
 */
export function prefetchEditor(): void {
  // The same specifier `Root` hands to `lazy()`, resolved from a different
  // directory. Rollup emits one chunk for the module either way, which is the
  // whole point: a second specifier that resolved elsewhere would prefetch a
  // copy and warm nothing.
  void import("./EditorRoute");
}

/**
 * Runs the prefetch when the browser has nothing better to do.
 *
 * Not on mount. The grid's own work comes first — its list, its posters, and
 * `usePosters` decoding a video frame for every recording that has never been
 * opened — and a 784 KB parse competing with that would make the screen the
 * user is actually looking at slower to fill.
 *
 * Returns its own cancel, so a library unmounted before the callback runs does
 * not warm a chunk for a window that has gone.
 */
export function prefetchEditorWhenIdle(): () => void {
  // `requestIdleCallback` is Chromium's and this only ever runs there, but the
  // timeout is what stops a busy window from deferring this for ever.
  const handle = requestIdleCallback(prefetchEditor, { timeout: 2_000 });
  return () => cancelIdleCallback(handle);
}
