import { Suspense, lazy } from "react";

/**
 * Every window loads the same bundle and picks its view from the hash.
 *
 * One entry point keeps electron-vite's dev server and HMR working identically
 * for the bottom panel and the selection overlays.
 *
 * Each view is loaded on demand rather than imported at the top, because "the
 * same bundle" used to mean the same *chunk*: the editor is 784 KB of source
 * against the dock's 60 KB, so the menu-bar panel — which is up for the whole
 * life of the app — and the selection overlay — which has to appear the
 * instant a recording starts — were both parsing `layout.ts`, `Inspector.tsx`,
 * `TimelineStrip.tsx` and the WebGL compositor before they could draw
 * anything. A window now parses its own view and nothing else.
 */
const Camera = lazy(() => import("./camera/Camera").then((m) => ({ default: m.Camera })));
const Dock = lazy(() => import("./dock/Dock").then((m) => ({ default: m.Dock })));
const DockMenu = lazy(() => import("./dock/DockMenu").then((m) => ({ default: m.DockMenu })));
const Selection = lazy(() =>
  import("./selection/Selection").then((m) => ({ default: m.Selection })),
);
const Update = lazy(() => import("./update/Update").then((m) => ({ default: m.Update })));
const Welcome = lazy(() => import("./welcome/Welcome").then((m) => ({ default: m.Welcome })));
const Workspace = lazy(() =>
  import("./workspace/Workspace").then((m) => ({ default: m.Workspace })),
);

function view(route: string) {
  switch (route) {
    case "/dock":
      return <Dock />;
    // The panel's drop-ups, which are a window of their own so that they can
    // carry the same frosted material the panel does — see `DockMenu`.
    case "/dock-menu":
      return <DockMenu />;
    case "/selection":
      return <Selection />;
    case "/camera":
      return <Camera />;
    // One route for every screen the app window has — the library, its panes
    // and the editor. Which one is showing is pushed by main, so a reload lands
    // back where the window was rather than on the grid.
    case "/workspace":
      return <Workspace />;
    case "/welcome":
      return <Welcome />;
    // Straight to the step the window opened for. A separate route rather than
    // a query, because the switch above matches the hash exactly and a `?step=`
    // would fall through to the unknown-route branch.
    case "/welcome/permissions":
      return <Welcome startAt="permissions" />;
    case "/update":
      return <Update />;
    default:
      return <p className="p-6 text-muted">Unknown route: {route}</p>;
  }
}

export function Root() {
  const route = window.location.hash.replace(/^#/, "") || "/dock";

  // Nothing rather than a spinner. Every one of these windows is opened by main
  // already sized and positioned, and several of them are transparent overlays
  // — a placeholder would be a flash of something the window is not, on top of
  // the screen the user is about to record. The chunk is local and the wait is
  // a frame or two.
  return <Suspense fallback={null}>{view(route)}</Suspense>;
}
