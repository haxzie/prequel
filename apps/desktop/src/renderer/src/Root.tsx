import { Camera } from "./camera/Camera";
import { Dock } from "./dock/Dock";
import { Editor } from "./editor/Editor";
import { Selection } from "./selection/Selection";
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
    default:
      return <p className="p-6 text-muted">Unknown route: {route}</p>;
  }
}
