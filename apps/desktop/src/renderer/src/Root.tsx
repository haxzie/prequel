import { Camera } from "./camera/Camera";
import { Dock } from "./dock/Dock";
import { DockMenu } from "./dock/DockMenu";
import { Selection } from "./selection/Selection";
import { Update } from "./update/Update";
import { Welcome } from "./welcome/Welcome";
import { Workspace } from "./workspace/Workspace";

/**
 * Every window loads the same bundle and picks its view from the hash.
 *
 * One entry point keeps electron-vite's dev server and HMR working identically
 * for the bottom panel and the selection overlays.
 */
export function Root() {
  const route = window.location.hash.replace(/^#/, "") || "/dock";

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
    // a query, because the switch below matches the hash exactly and a `?step=`
    // would fall through to the unknown-route branch.
    case "/welcome/permissions":
      return <Welcome startAt="permissions" />;
    case "/update":
      return <Update />;
    default:
      return <p className="p-6 text-muted">Unknown route: {route}</p>;
  }
}
