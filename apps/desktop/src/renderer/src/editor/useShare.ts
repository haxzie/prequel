/**
 * Uploading a finished export, and following it.
 *
 * State lives in main, not here. The dialog can be closed mid-upload and
 * reopened — closing is not cancelling, exactly as it is for the export itself —
 * so progress has to survive this component being unmounted.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ShareProgress } from "../../../shared/contract";
import type { ExportResult } from "./useExport";

export interface ShareState {
  progress: ShareProgress | null;
  uploading: boolean;
  /** The share link, once there is one. */
  url: string | null;
  /** 0–1 while uploading, null before there is a total to divide by. */
  fraction: number | null;
  error: string | null;
  start: (title: string, poster: string | null, durationMs: number) => Promise<void>;
  cancel: () => void;
}

export function useShare(result: ExportResult | null, frame: { width: number; height: number }) {
  const [progress, setProgress] = useState<ShareProgress | null>(null);

  useEffect(() => window.prequel.editor.share.onProgress(setProgress), []);

  // Cleared when the file changes, so a second export does not open showing the
  // first one's link — which would be a link to the wrong recording, and one the
  // user would have no reason to doubt.
  useEffect(() => setProgress(null), [result?.path]);

  const start = useCallback(
    async (title: string, poster: string | null, durationMs: number) => {
      if (!result) return;

      // Shown immediately rather than waiting for the first tick from main, so
      // pressing Share cannot look like it did nothing.
      setProgress({
        path: result.path,
        stage: "preparing",
        bytesSent: 0,
        bytesTotal: 0,
        url: null,
        error: null,
      });

      const started = await window.prequel.editor.share.start({
        path: result.path,
        poster,
        title,
        durationMs,
        width: frame.width,
        height: frame.height,
      });

      if (!started.ok) {
        setProgress({
          path: result.path,
          stage: "failed",
          bytesSent: 0,
          bytesTotal: 0,
          url: null,
          error: { code: started.code, message: started.message },
        });
      }
    },
    [result, frame.width, frame.height],
  );

  const cancel = useCallback(() => void window.prequel.editor.share.cancel(), []);

  // Progress for some other export is ignored outright. The broadcast reaches
  // every window, and an editor open on a different recording would otherwise
  // show a stranger's upload filling its Share button.
  const mine = result && progress?.path === result.path ? progress : null;

  return useMemo(
    (): ShareState => ({
      progress: mine,
      uploading:
        mine !== null &&
        (mine.stage === "preparing" || mine.stage === "uploading" || mine.stage === "finalising"),
      url: mine?.stage === "done" ? mine.url : null,
      fraction:
        mine?.stage === "uploading" && mine.bytesTotal > 0
          ? Math.min(mine.bytesSent / mine.bytesTotal, 1)
          : null,
      error: mine?.stage === "failed" ? (mine.error?.message ?? "That didn't upload.") : null,
      start,
      cancel,
    }),
    [mine, start, cancel],
  );
}
