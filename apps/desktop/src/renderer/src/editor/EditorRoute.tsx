import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { EditorSession, SessionDetails } from "../../../shared/contract";
import { navigate } from "../lib/route";
import { Editor } from "./Editor";
import { Opening } from "./Opening";

/** Where the route is: asking main, drawing an editor, or pointing at nothing. */
type RouteState =
  { status: "loading" } | { status: "ready"; session: EditorSession } | { status: "missing" };

/**
 * One recording's editor, fetched for the route it is on.
 *
 * The route carries the recording's folder name and this asks main for the rest.
 * It used to arrive the other way round — main read the session and pushed it,
 * having first announced that one was coming so the window had something to
 * draw meanwhile. Pulling it here collapses both of those into one await, and
 * puts the answer to "which recording is this window on" in exactly one place.
 *
 * **`Editor` is not rendered until the session exists**, which is the property
 * the push had and this has to keep. It seeds its reducer from the session on
 * its very first render, and seeding that with a placeholder is how the first
 * cut once came to replace a saved project's zooms on every reopen. So the
 * loading state here renders `Opening`, never an `Editor` with nothing in it.
 *
 * That loading state is now the length of a few file reads, not of a media probe
 * and a desktop screenshot: `editor:session` answers from the manifest and this
 * asks `editor:sessionDetails` for the rest once the editor is drawn. The whole
 * window used to sit on "Opening …" until both were done.
 */
export function EditorRoute({ name }: { name: string }) {
  const [state, setState] = useState<RouteState>({ status: "loading" });
  /**
   * Bumped when main says the recording has changed on disk.
   *
   * A counter rather than a refetch in place, because it is also the `Editor`'s
   * key: a take appended to the recording lengthens its source clock, and the
   * reducer reads that once, when it is seeded. Remounting drops the undo history
   * — which is the honest outcome, since every `Project` in it predates the
   * footage that has just been added — and the selection, which `focusSliceId`
   * replaces with the new clip anyway.
   */
  const [reloads, setReloads] = useState(0);

  useEffect(
    () =>
      window.prequel.editor.onReload((changed) => {
        // Only this recording. Main sends to the window, and a window showing
        // something else has no business rereading on its behalf.
        if (changed === name) setReloads((count) => count + 1);
      }),
    [name],
  );

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });

    void window.prequel.editor.session(name).then((result) => {
      // The route changed while the media was being probed, which takes long
      // enough for somebody to have gone back to the library. Whatever arrives
      // now belongs to a screen that is no longer here.
      if (!live) return;

      if (!result.ok || !result.value) {
        setState({ status: "missing" });
        return;
      }

      setState({ status: "ready", session: result.value });
    });

    return () => {
      live = false;
      // Both ends of the visit are reported, and this is the far one: main
      // flushes the held edit on the strength of it. React runs this before the
      // next screen mounts, so leaving one recording for another is still in
      // order.
      void window.prequel.editor.leave();
    };
  }, [name, reloads]);

  useDetails(name, reloads, state.status === "ready" ? state.session : null, setState);

  if (state.status === "loading") return <Opening name={name} />;
  if (state.status === "missing") return <Missing name={name} />;

  // Keyed on the name, so opening a second recording gets a fresh editor rather
  // than one carrying the first's selection, history and playhead — and on the
  // reload count, so a recording that has just grown a take gets one too.
  return (
    <Editor
      key={`${name}:${String(reloads)}`}
      session={state.session}
      onBack={() => navigate("/workspace")}
    />
  );
}

/**
 * Fetches the slow half of the session and merges it into the fast one.
 *
 * Merged rather than kept beside it, because every consumer already reads these
 * off `EditorSession` and a second source for "how long is the camera track"
 * would be a second answer. The merge is safe for the reducer the moment the
 * project is left alone: `Editor` reads `session.project` once, to seed itself,
 * and what arrives here is the probe's numbers and one flag about a picture.
 *
 * A failure is not retried and is not reported. What it costs is precision — the
 * manifest's durations instead of the files' own — and the editor is fully usable
 * on those; a dialog over a working editor would be worse than the difference.
 */
function useDetails(
  name: string,
  reloads: number,
  session: EditorSession | null,
  setState: Dispatch<SetStateAction<RouteState>>,
) {
  // What this has already been asked for, so a re-render of the route does not
  // ask twice. A ref rather than a dependency on the session, which is a new
  // object the moment the answer is merged into it — and keyed on the reload
  // count as well as the directory, because a take appended to the recording
  // adds a file the probe has never seen.
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const key = `${session.dir}:${String(reloads)}`;
    if (asked.current === key) return;
    asked.current = key;

    let live = true;

    void window.prequel.editor.details(name).then((result) => {
      if (!live || !result.ok || !result.value) return;
      const details: SessionDetails = result.value;

      setState((current) => {
        // The route moved on while the probe ran, which is long enough for
        // somebody to have gone back to the library and opened something else.
        if (current.status !== "ready" || current.session.dir !== details.dir) return current;

        return {
          status: "ready",
          session: {
            ...current.session,
            media: details.media,
            backgroundMissing: details.backgroundMissing,
          },
        };
      });
    });

    return () => {
      live = false;
    };
  }, [name, reloads, session, setState]);
}

/**
 * A route pointing at a recording that is not there.
 *
 * Reachable in ordinary use: the window can be reloaded onto the route of a
 * recording that has since been deleted, and the hash survives a restart. It
 * used to be impossible to reach — main verified the directory before the
 * window moved — so this is the screen that pays for the route being real.
 */
function Missing({ name }: { name: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-editor-fg">{name} could not be opened</p>
        <p className="max-w-xs text-xs leading-relaxed text-editor-muted">
          It may have been deleted or moved out of the recordings folder.
        </p>
        <button
          type="button"
          className="rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-medium hover:bg-white/15"
          onClick={() => navigate("/workspace")}
        >
          Back to recordings
        </button>
      </div>
    </div>
  );
}
