/**
 * React Grab, in development only.
 *
 * Hover any element on the site and press ⌘C to copy it — with its component
 * stack and the source location behind each layer — for an agent to read.
 *
 * This file rather than a `<Script>` in the layout: Next runs it after the
 * document loads and *before* React hydrates, which is the window React Grab
 * wants, and it keeps a development tool out of the rendered app shell. The
 * package is a devDependency and this is the only thing that imports it, so a
 * production build has nothing to resolve.
 *
 * `import()` rather than a static import, guarded on `NODE_ENV`: Next inlines
 * that flag and drops the dead branch, so nothing of the package reaches a
 * visitor. The docs are explicit that the import is fire-and-forget and may
 * land after hydration has begun — fine here, because React Grab reads
 * component stacks off React's commits rather than needing to be installed
 * before the first one.
 */
if (process.env.NODE_ENV === "development") {
  // Failure to load a development overlay must not take the page with it.
  void import("react-grab").catch((cause) => {
    console.warn("[react-grab] could not load:", cause);
  });
}
