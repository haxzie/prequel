import { Suspense, lazy, useEffect } from "react";

import { TooltipLayer } from "./components/Tooltip";
import { Opening } from "./editor/Opening";
import { navigate, recordingInRoute, useRoute } from "./lib/route";

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
const EditorRoute = lazy(() =>
  import("./editor/EditorRoute").then((m) => ({ default: m.EditorRoute })),
);

function view(route: string) {
  // Before the switch, because this route has a recording's name on the end of
  // it and the switch matches exactly — the same reason `/welcome/permissions`
  // is a case of its own rather than `/welcome?step=`.
  const recording = recordingInRoute(route);
  if (recording) return <EditorRoute name={recording} />;

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
    // The app window's library: the grid and Settings. The editor is
    // `/editor/<name>` above, so a reload lands back on the recording that was
    // open rather than on the grid.
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

/**
 * Routes the app window can be on.
 *
 * Main only ever sends a navigation to that window, so this is belt and braces
 * — but every window in the app runs this same `Root`, and a stray move that
 * took the dock panel to `/workspace` would be a panel with a recordings grid
 * in it and no way back.
 */
function ownsNavigation(route: string): boolean {
  return route === "/workspace" || route.startsWith("/editor/");
}

export function Root() {
  // Read on every render rather than once. The hash is what moves the app
  // window between the library and an editor now, and main can move it too.
  const route = useRoute();

  /**
   * Main asking the window to go somewhere.
   *
   * Here rather than inside the library, which is where it started and where it
   * was wrong: `Workspace` is unmounted for the whole time an editor is on
   * screen, so every move main made while one was open went to nobody. Deleting
   * the recording being edited left the window sitting on it, the tray's Open
   * Recordings did nothing from an editor, and a take finishing while one was
   * open did not bring the new one up.
   *
   * `Root` is the one component that is mounted whatever the route is.
   */
  useEffect(() => {
    if (!ownsNavigation(route)) return;
    return window.prequel.workspace.onNavigate(navigate);
  }, [route]);

  // Nothing rather than a spinner, for every window but one. They are opened by
  // main already sized and positioned, and several are transparent overlays — a
  // placeholder would be a flash of something the window is not, on top of the
  // screen the user is about to record.
  //
  // The exception is the editor, which is the one route that says what it is
  // waiting for: its name is in the URL, so the window can name the recording
  // while the chunk that draws it is still loading, rather than showing an
  // empty frame for the length of a 784 KB parse.
  const recording = recordingInRoute(route);

  return (
    <>
      <Suspense fallback={recording ? <Opening name={recording} /> : null}>{view(route)}</Suspense>
      {/* One bubble per window, whatever the view: the dock and the editor
          both label their icons through it. Outside the Suspense boundary so
          it is not part of any chunk's fallback. */}
      <TooltipLayer />
    </>
  );
}
