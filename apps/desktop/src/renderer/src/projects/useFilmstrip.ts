import { useEffect, useState } from "react";

import { FILMSTRIP_FRAMES } from "../../../shared/contract";
import { TRACK_FILE_NAMES } from "../../../shared/manifest";
import { mediaUrl, recordingName } from "../../../shared/media-url";
import { captureFilmstrip } from "../editor/poster";

/**
 * Strips made in this window, by directory.
 *
 * Module-level rather than in state, for the same reason `usePosters` keys on
 * directories: a re-list after a rename builds new components over the same
 * recordings, and a cache inside one of them would take every strip again.
 *
 * A null value is a recording whose screen track would not decode. Kept, so a
 * broken take is tried once per window rather than once per hover.
 */
const made = new Map<string, string | null>();

/**
 * One capture at a time, whichever tile asked for it.
 *
 * A strip is `FILMSTRIP_FRAMES` seeks and as many decodes. Dragging the pointer
 * across a grid would otherwise start one of those for every tile it passed
 * over, and they would all still be running when the pointer stopped — the tile
 * actually being looked at would be last in a queue of ones nobody wanted.
 */
let queue: Promise<void> = Promise.resolve();

/**
 * The hover preview for one recording, made on demand.
 *
 * Not with the rest of the grid. The poster costs one seek per recording and
 * every tile shows one; this costs six, and in a library of forty takes
 * thirty-nine of them are for tiles nobody points at.
 */
export function useFilmstrip(dir: string, cached: string | null, wanted: boolean): string | null {
  const [strip, setStrip] = useState<string | null>(() => cached ?? made.get(dir) ?? null);

  useEffect(() => {
    // Nothing to do: one is already on screen, or one has been tried for this
    // recording and there is nothing to show for it.
    if (!wanted || strip !== null || made.has(dir)) return;

    let live = true;

    queue = queue.then(async () => {
      // Checked again here rather than only above: this runs after everything
      // queued ahead of it, by which time another tile may have made this one.
      if (made.has(dir)) return;

      const url = await captureFilmstrip(
        mediaUrl(recordingName(dir), TRACK_FILE_NAMES.screen),
        FILMSTRIP_FRAMES,
      );

      // Remembered even when the pointer has moved on. The frames are made and
      // the file is worth keeping either way — the next hover is then instant,
      // and the next window opens with it already on disk.
      made.set(dir, url);
      if (!url) return;

      void window.prequel.projects.saveFilmstrip(dir, url);
      if (live) setStrip(url);
    });

    // The chain outlives every tile on it, so nothing may be allowed to reject
    // it: a single throw would leave every `then` queued behind it skipped, and
    // hover previews would stop for the rest of the session with one warning to
    // explain it.
    queue = queue.catch((cause: unknown) => {
      console.warn("[library] a hover preview failed:", cause);
    });

    return () => {
      live = false;
    };
  }, [dir, wanted, strip]);

  return strip;
}
