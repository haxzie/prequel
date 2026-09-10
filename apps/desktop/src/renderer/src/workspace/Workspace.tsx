import { useCallback, useEffect, useState } from "react";

import type { WorkspaceSection } from "../../../shared/contract";
import { recordingName } from "../../../shared/media-url";
import { prefetchEditorWhenIdle } from "../editor/prefetch";
import { navigate } from "../lib/route";
import { Library } from "./Library";

/**
 * The app window's library: the Projects grid and Settings.
 *
 * It used to be the whole window — the library, a recording on its way, and the
 * editor, chosen between by four pieces of state that main pushed. Three of
 * those encoded one lifecycle, and it is a route now: opening a recording sets
 * the hash, and `EditorRoute` fetches what it needs. What is left here is the
 * pane, which is genuinely the window's own business.
 *
 * One thing still arrives from main: the tray asking for Settings. Navigation
 * is handled a level up in `Root`, because a window told to go somewhere is
 * usually a window that is *not* showing this — see the note there.
 */
export function Workspace() {
  /**
   * Which pane of the library is showing.
   *
   * Seeded from main on every load rather than defaulting here: the window
   * restores where it was after a reload, and the tray can open it straight
   * onto Settings.
   */
  const [section, setSection] = useState<WorkspaceSection>("projects");

  useEffect(() => window.prequel.workspace.onSection(setSection), []);

  // The editor's chunk, warmed while the library is on screen. Nobody opens the
  // library to look at the library, and this is the difference between a click
  // that lands in an editor and one that lands on `Opening…`.
  useEffect(() => prefetchEditorWhenIdle(), []);

  // Last, and deliberately so: both subscriptions above are registered by the
  // time this runs, which is the whole point of asking rather than being told.
  // This view is a `lazy()` chunk, so the window's page had finished loading
  // well before either of them existed — main pushing then sent the section to
  // nobody and the window stayed on the grid.
  useEffect(() => {
    void window.prequel.workspace.ready();
  }, []);

  // Straight to the route. There is no "opening" state to hold here any more:
  // the grid unmounts on the spot and the editor route names the recording it
  // is fetching, which is what the card used to have to say on its behalf.
  const open = useCallback((dir: string) => {
    navigate(`/editor/${encodeURIComponent(recordingName(dir))}`);
  }, []);

  return <Library section={section} onSection={setSection} onOpen={open} />;
}
