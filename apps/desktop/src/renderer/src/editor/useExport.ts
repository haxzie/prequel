/**
 * Starting an export, and following it.
 *
 * The slices are built by `exportSlices.ts`, which is also what a headless
 * `prequel render` calls — so the exporter receives the same geometry whichever
 * side asked for it. See `shared/layout.ts` for why that matters.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorSession, ExportProgress } from "../../../shared/contract";
import type { RenderedCue, RenderedText, Size } from "../../../shared/layout";
import { outputFrame, type OutputSettings, type Project } from "../../../shared/project";
import { buildSlices } from "./exportSlices";
import { slicesOf } from "./state";
import { tagFor, type CursorTags } from "./useCursorTags";

// Re-exported because it was exported from here when the editor and its test
// were the only callers. Moving the symbol as well as the code would have been
// a rename across both for no behaviour.
export { buildSlices };

/** A finished export, in the form the dialog needs to show and hand it on. */
export interface ExportResult {
  /** Absolute path, for Finder, the pasteboard and the drag. */
  path: string;
  /** A `prequel-media://` URL, which is the only way the renderer can show it. */
  url: string;
  /**
   * Whether this is a GIF, which is shown as an image rather than played.
   *
   * Read off the extension rather than from the settings the export was started
   * with: those can be changed while it runs, and a `<video>` pointed at a GIF
   * shows nothing at all.
   */
  isGif: boolean;
  /**
   * How big the file is, in bytes, or null when main could not read it.
   *
   * Null rather than zero: "not known" and "empty" are the same number, and the
   * dialog says nothing at all in the first case rather than claiming 0 bytes
   * for a file that plays.
   */
  bytes: number | null;
}

export interface ExportState {
  progress: ExportProgress | null;
  running: boolean;
  /** The finished file, until the dialog is dismissed. */
  result: ExportResult | null;
  /** The frame this export would be written at, once the format is applied. */
  frame: Size;
  /**
   * How long the finished file runs, in milliseconds.
   *
   * Summed over the kept slices rather than taken from the recording, because
   * what was cut out is exactly the difference between the two — and this is
   * what the library shows beside the thumbnail.
   */
  durationMs: number;
  start: () => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
}

export function useExport(
  session: EditorSession | null,
  project: Project,
  output: OutputSettings,
  captions: { byLook: ReadonlyMap<string, readonly RenderedCue[]>; drawing: boolean },
  texts: { rendered: ReadonlyMap<string, RenderedText>; drawing: boolean },
  tags: CursorTags,
): ExportState {
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  useEffect(() => window.prequel.editor.export.onProgress(setProgress), []);

  const frame = useMemo(
    () => outputFrame(project.frame, output.shortEdge),
    [project.frame, output.shortEdge],
  );

  // Read through a ref because `start` runs long after it was created, and the
  // bitmaps it has to wait for are still being written while it does.
  const drawing = useRef(captions.drawing || texts.drawing);
  drawing.current = captions.drawing || texts.drawing;
  /**
   * The bitmaps, read at the moment the plan is built rather than captured.
   *
   * `start` is a callback with a dependency list, and the text bitmaps were
   * left off it: the closure kept the map from the render it was made on,
   * every later edit redrew the fields under new names and swept the old,
   * and the export named files that were no longer there. The exporter
   * skips a bitmap it cannot decode, so the video simply had no titles. A
   * ref has no list to forget them from; `settled` above already waits on
   * the same ref pattern for the same reason.
   */
  const bitmaps = useRef({ cues: captions.byLook, texts: texts.rendered, tags });
  bitmaps.current = { cues: captions.byLook, texts: texts.rendered, tags };

  const start = useCallback(async () => {
    if (!session) return;

    // Where it goes is asked before anything is rendered. Dismissing the sheet
    // leaves the dialog exactly as it was — no progress, no failure — because
    // choosing not to export is not an export that went wrong.
    const chosen = await window.prequel.editor.export.choose(output.format);
    if (!chosen.ok) {
      setProgress({
        stage: "failed",
        framesDone: 0,
        framesTotal: 0,
        outputPath: null,
        error: { code: chosen.code, message: chosen.message },
      });
      return;
    }
    if (!chosen.value) return;

    // Shown immediately rather than waiting for the first tick from main, so
    // pressing Export cannot look like it did nothing.
    setProgress({
      stage: "preparing",
      framesDone: 0,
      framesTotal: 0,
      outputPath: null,
      error: null,
    });

    // Captions are laid out and written by the renderer, and an export that
    // starts mid-draw silently produces a plainer video — the plan names
    // bitmaps that are not on disk yet, and the exporter skips what it cannot
    // decode. Waited for after the save dialog, so the wait is never the first
    // thing that happens when Export is pressed.
    await settled(drawing);

    const size = outputFrame(project.frame, output.shortEdge);

    const result = await window.prequel.editor.export.start({
      dir: session.dir,
      output: chosen.value,
      width: size.width,
      height: size.height,
      fps: output.fps,
      format: output.format,
      // The plan is laid out inside the *export's* frame, not the editor's, so
      // a scaled-down export is the same composition rather than a crop of it.
      slices: buildSlices(
        session,
        project,
        size,
        bitmaps.current.cues,
        bitmaps.current.texts,
        (layout) => tagFor(layout, bitmaps.current.tags),
      ),
      sound: session.sound,
    });

    if (!result.ok) {
      setProgress({
        stage: "failed",
        framesDone: 0,
        framesTotal: 0,
        outputPath: null,
        error: { code: result.code, message: result.message },
      });
    }
  }, [session, project, output]);

  const cancel = useCallback(() => void window.prequel.editor.export.cancel(), []);

  // Held against the progress rather than in state of its own: "done" already
  // carries the path, and a second copy could disagree with it after a retry.
  const result = useMemo((): ExportResult | null => {
    if (!session || progress?.stage !== "done" || !progress.outputPath || !progress.url) {
      return null;
    }

    const name = progress.outputPath.split("/").pop() ?? "";
    return {
      path: progress.outputPath,
      // Handed over with the progress rather than built here. The file is
      // wherever the save dialog put it — nowhere the recordings route can
      // reach — so the `export` route is an allow-list keyed by an id only
      // main knows, and a URL assembled in the renderer can only 404.
      url: progress.url,
      isGif: name.endsWith(".gif"),
      bytes: progress.bytes ?? null,
    };
  }, [session, progress]);

  const durationMs = useMemo(
    () =>
      slicesOf(project).reduce(
        (total, slice) => total + (slice.source.end - slice.source.start),
        0,
      ) / 1_000_000,
    [project],
  );

  return {
    progress,
    running:
      progress !== null &&
      (progress.stage === "preparing" ||
        progress.stage === "rendering" ||
        progress.stage === "finalising"),
    result,
    frame,
    durationMs,
    start,
    cancel,
    dismiss: () => setProgress(null),
  };
}

/**
 * Waits for the caption bitmaps to stop being written.
 *
 * Polled rather than awaited on a promise because the drawing is driven by a
 * debounce in another hook, which has no completion to hand out — and a slider
 * still under a finger can restart it, so the answer has to be re-asked rather
 * than remembered.
 */
async function settled(drawing: { current: boolean }): Promise<void> {
  while (drawing.current) {
    await new Promise((resume) => setTimeout(resume, 50));
  }
}
