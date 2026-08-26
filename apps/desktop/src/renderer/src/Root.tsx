import { Camera } from "./camera/Camera";
import { Dock } from "./dock/Dock";
import { Editor } from "./editor/Editor";
import { Selection } from "./selection/Selection";
import { Settings } from "./settings/Settings";
import { Update } from "./update/Update";
import { Welcome } from "./welcome/Welcome";

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
    case "/selection":
      return <Selection />;
    case "/camera":
      return <Camera />;
    case "/editor":
      return <Editor />;
    case "/welcome":
      return <Welcome />;
    // Straight to the step the window opened for. A separate route rather than
    // a query, because the switch below matches the hash exactly and a `?step=`
    // would fall through to the unknown-route branch.
    case "/welcome/permissions":
      return <Welcome startAt="permissions" />;
    case "/settings":
      return <Settings />;
    case "/update":
      return <Update />;
    default:
      return <p className="p-6 text-muted">Unknown route: {route}</p>;
  }
}
