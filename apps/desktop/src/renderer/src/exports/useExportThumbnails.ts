import { useEffect, useState } from "react";

import type { ExportSummary } from "../../../shared/contract";
import { capturePoster } from "../editor/poster";

/**
 * Fills in the thumbnails an export does not have yet.
 *
 * The same arrangement the Projects grid has with its posters, and for the same
 * reason: the renderer is the only process here that can decode video, so the
 * pane takes its own stills and hands them back for main to keep. Every one
 * after the first is read straight off disk.
 *
 * **One at a time.** Each still is a decode plus a seek, and starting twenty at
 * mount hands the compositor twenty simultaneous decodes and stalls the list
 * they are meant to fill.
 */
export function useExportThumbnails(exports: ExportSummary[]): Map<string, string> {
  const [made, setMade] = useState<Map<string, string>>(new Map());

  // Keyed on the paths rather than on the array: re-listing after an export
  // lands builds a new array of the same files, and restarting the queue there
  // would take every still a second time.
  const key = exports
    .filter((entry) => entry.thumbnail === null)
    .map((entry) => entry.path)
    .join("\n");

  useEffect(() => {
    const missing = key.split("\n").filter(Boolean);
    if (missing.length === 0) return;

    let live = true;

    void (async () => {
      for (const path of missing) {
        // Checked between files rather than only at the top: the pane can be
        // left for another one partway through, and a still taken after that
        // is work nobody is waiting for.
        if (!live) return;

        const entry = exports.find((candidate) => candidate.path === path);
        if (!entry) continue;

        const still = await capturePoster(entry.url, entry.isGif);
        if (!live) return;
        // Null for a file that would not decode — an export written by an
        // older build, a file half-copied onto a drive. The row keeps its
        // placeholder, and the next time the pane opens it tries again.
        if (!still) continue;

        setMade((current) => new Map(current).set(path, still));
        void window.prequel.exports.saveThumbnail(path, still);
      }
    })();

    return () => {
      live = false;
    };
    // `exports` is deliberately not a dependency: it is a fresh array on every
    // render and the queue is keyed on the paths inside it, which is the thing
    // that actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return made;
}
