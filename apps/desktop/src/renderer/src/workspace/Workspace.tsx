import { useCallback, useEffect, useState } from "react";

import type { EditorSession, WorkspaceSection } from "../../../shared/contract";
import { Editor } from "../editor/Editor";
import { Library } from "./Library";

/**
 * The app window: the library, and the editor for one recording.
 *
 * The only navigation state there is. Main owns which recording is open — it
 * has to, because leaving one means writing its edit before the next loads —
 * so this asks main to move and then follows what main pushes back rather than
 * switching on its own and hoping the two agree.
 *
 * The library's own pane is the one thing this decides for itself, because
 * nothing outside the window cares which of them is showing — except the tray's
 * Settings item, which arrives as a push like everything else.
 */
export function Workspace() {
  const [session, setSession] = useState<EditorSession | null>(null);
  /**
   * The card that was clicked, until its recording arrives.
   *
   * Opening one probes its media, which takes long enough to look like a click
   * that did nothing. Held here rather than in the grid so it survives the
   * grid's own re-list.
   */
  const [opening, setOpening] = useState<string | null>(null);
  /**
   * Which pane of the library is showing.
   *
   * Seeded from main on every load rather than defaulting here: the window
   * restores where it was after a reload, and the tray can open it straight
   * onto Settings.
   */
  const [section, setSection] = useState<WorkspaceSection>("projects");

  useEffect(() => window.prequel.workspace.onSection(setSection), []);

  useEffect(
    () =>
      window.prequel.editor.onOpen((opened) => {
        setSession(opened);
        setOpening(null);
      }),
    [],
  );

  // The other direction, and the reason this screen is never chosen here: the
  // tray can ask for the grid over an open editor, and deleting the recording
  // on screen takes the window off it. Both arrive as this.
  useEffect(
    () =>
      window.prequel.projects.onShowing(() => {
        setSession(null);
        setOpening(null);
      }),
    [],
  );

  const open = useCallback(async (dir: string) => {
    setOpening(dir);
    const result = await window.prequel.projects.open(dir);
    // A recording that will not open — moved, or with an unreadable manifest.
    // Main has already logged why; here it just stops looking like it is still
    // loading, and the grid's next list will have dropped it.
    if (!result.ok) setOpening(null);
  }, []);

  // Asks, and waits for `onShowing` to answer. Main writes the edit being left
  // behind on the way, and switching here as well would mean the screen and the
  // window's idea of what it is showing could disagree.
  const back = useCallback(() => void window.prequel.projects.show(), []);

  // Keyed on the directory, so opening a second recording gets a fresh editor
  // rather than one carrying the first's selection, history and playhead.
  return session ? (
    <Editor key={session.dir} session={session} onBack={back} />
  ) : (
    <Library section={section} onSection={setSection} opening={opening} onOpen={open} />
  );
}
