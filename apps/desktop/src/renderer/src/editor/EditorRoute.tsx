import { useEffect, useState } from "react";

import type { EditorSession } from "../../../shared/contract";
import { navigate } from "../lib/route";
import { Editor } from "./Editor";
import { Opening } from "./Opening";

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
 */
export function EditorRoute({ name }: { name: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; session: EditorSession } | { status: "missing" }
  >({ status: "loading" });

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
  }, [name]);

  if (state.status === "loading") return <Opening name={name} />;
  if (state.status === "missing") return <Missing name={name} />;

  // Keyed on the name, so opening a second recording gets a fresh editor rather
  // than one carrying the first's selection, history and playhead.
  return <Editor key={name} session={state.session} onBack={() => navigate("/workspace")} />;
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
