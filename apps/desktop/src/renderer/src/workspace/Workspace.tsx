import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import type { EditorSession, WorkspaceSection } from "../../../shared/contract";
import { recordingName } from "../../../shared/media-url";
import { Library } from "./Library";

/**
 * Loaded when a recording is opened, not when the window is.
 *
 * `Root` already splits a chunk per view so a window parses only what it draws.
 * This window draws two things, and the editor is almost all of the weight —
 * the compositor, the geometry, the inspector and the timeline — so the library
 * was paying for it on every open and showing an empty shell while it parsed.
 * Splitting again here is the same rule applied one level down.
 *
 * Its fallback is the same line an arriving recording shows, so a cold open and
 * a warm one look identical: there is one "a recording is on its way" state,
 * whether what is missing is the chunk or the probe.
 */
const Editor = lazy(() => import("../editor/Editor").then((m) => ({ default: m.Editor })));

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
  /**
   * A recording main says is on its way, until it arrives.
   *
   * Distinct from `opening` above, which belongs to the grid: that one marks a
   * card and leaves the list underneath it, because the list is what the user
   * is looking at. This one means the window is here for a recording and the
   * library is not what it should be showing meanwhile — stopping a take used
   * to flash the grid for as long as probing its media took, which reads as
   * having opened the wrong thing.
   */
  const [arriving, setArriving] = useState<string | null>(null);

  useEffect(() => window.prequel.workspace.onSection(setSection), []);

  useEffect(
    () =>
      window.prequel.editor.onOpen((opened) => {
        setSession(opened);
        setOpening(null);
        setArriving(null);
      }),
    [],
  );

  useEffect(() => window.prequel.editor.onOpening(setArriving), []);

  // The other direction, and the reason this screen is never chosen here: the
  // tray can ask for the grid over an open editor, and deleting the recording
  // on screen takes the window off it. Both arrive as this.
  useEffect(
    () =>
      window.prequel.projects.onShowing(() => {
        setSession(null);
        setOpening(null);
        // Asked for the library on purpose, so it is no longer waiting on
        // whatever was arriving — a push that lands afterwards is stale and
        // `push` drops it for the same reason.
        setArriving(null);
      }),
    [],
  );

  // Last, and deliberately so: every subscription above is registered by the
  // time this runs, which is the whole point of asking rather than being told.
  // This view is a `lazy()` chunk, so the window's page had finished loading
  // well before any of them existed — main pushing then sent the section and
  // the arriving recording to nobody, and the window stayed on the library
  // after a take.
  useEffect(() => {
    void window.prequel.workspace.ready();
  }, []);

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
  if (session) {
    return (
      <Suspense fallback={<Opening dir={session.dir} />}>
        <Editor key={session.dir} session={session} onBack={back} />
      </Suspense>
    );
  }

  if (arriving) return <Opening dir={arriving} />;

  return <Library section={section} onSection={setSection} opening={opening} onOpen={open} />;
}

/**
 * A recording on its way, whether what is missing is its media or its chunk.
 *
 * Deliberately almost nothing: it is on screen for a few hundred milliseconds
 * and only ever on the way to an editor. A skeleton of the editor would be a
 * second layout to keep in step with the real one, and a spinner in an empty
 * window says less than the name of what is opening.
 */
function Opening({ dir }: { dir: string }) {
  return (
    <div className="grid h-full place-items-center text-xs text-editor-muted">
      <p className="animate-pulse">Opening {recordingName(dir)}…</p>
    </div>
  );
}
