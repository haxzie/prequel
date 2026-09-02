/**
 * Starting an export, and following it.
 *
 * The plan for each slice is built here from the same `buildRenderPlan` the
 * preview draws with, so the exporter receives geometry rather than settings —
 * see `shared/layout.ts` for why that matters.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cursorImages,
  type EditorSession,
  type ExportProgress,
  type ExportSlice,
} from "../../../shared/contract";
import { buildRenderPlan, type RenderedCue, type Size } from "../../../shared/layout";
import type { TrackKind } from "../../../shared/manifest";
import { exportUrl } from "../../../shared/media-url";
import {
  captionLook,
  outputFrame,
  resolveSettings,
  type OutputSettings,
  type Project,
} from "../../../shared/project";
import { slicesOf } from "./state";

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
): ExportState {
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  useEffect(() => window.prequel.editor.export.onProgress(setProgress), []);

  const frame = useMemo(
    () => outputFrame(project.frame, output.shortEdge),
    [project.frame, output.shortEdge],
  );

  // Read through a ref because `start` runs long after it was created, and the
  // bitmaps it has to wait for are still being written while it does.
  const drawing = useRef(captions.drawing);
  drawing.current = captions.drawing;

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
      slices: buildSlices(session, project, size, captions.byLook),
      offsets: offsetsOf(session),
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
  }, [session, project, output, captions.byLook]);

  const cancel = useCallback(() => void window.prequel.editor.export.cancel(), []);

  // Held against the progress rather than in state of its own: "done" already
  // carries the path, and a second copy could disagree with it after a retry.
  const result = useMemo((): ExportResult | null => {
    if (!session || progress?.stage !== "done" || !progress.outputPath) return null;

    const name = progress.outputPath.split("/").pop() ?? "";
    return {
      path: progress.outputPath,
      // By name, through the scheme's `export` route — the file is wherever the
      // save dialog put it, which is nowhere the recordings route can reach.
      url: exportUrl(name),
      isGif: name.endsWith(".gif"),
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

/** Resolves every slice into geometry and gain the exporter can render. */
function buildSlices(
  session: EditorSession,
  project: Project,
  frame: Size,
  cues: ReadonlyMap<string, readonly RenderedCue[]>,
): ExportSlice[] {
  const sources = sourceSizes(session);

  const all = slicesOf(project);

  return all.map((slice, index) => {
    const settings = resolveSettings(project.defaults, slice.overrides);
    // The slice before this one, so the camera arrives rather than teleports.
    // The first slice has nothing behind it and gets no transition, which is
    // what makes an export open on its composition rather than assembling it.
    const previous = index > 0 ? all[index - 1] : undefined;

    return {
      start: slice.source.start,
      end: slice.source.end,
      // The same function the preview draws from, so the two cannot disagree
      // about where anything sits.
      plan: buildRenderPlan(
        frame,
        sources,
        settings,
        session.cursor && {
          ...session.cursor,
          ...cursorImages(settings.layout.cursorStyle),
          size: settings.layout.cursorSize,
          hideAfter: settings.layout.cursorAutoHide ? settings.layout.cursorHideAfter : null,
          // Resolved here rather than in the plan, like `hideAfter`: a track
          // with no spans and one the user asked to keep the pointer through
          // are the same thing to draw.
          keys: settings.layout.cursorHideWhileTyping ? session.cursor.keys : [],
        },
        project.zooms,
        previous
          ? {
              from: resolveSettings(project.defaults, previous.overrides),
              source: slice.source,
            }
          : null,
        // This clip's own look. Caption settings are per clip, so a clip that
        // styles its captions differently is handed the set drawn for it —
        // and one whose captions are off has no look and gets nothing.
        //
        // Every cue in that set, not only the ones inside this clip: a caption
        // whose span falls outside simply never draws, and filtering here would
        // be a second answer to a question `captionAt` already answers per
        // frame.
        cues.get(captionLook(settings.captions)),
        project.blurs,
      ),
      micVolume: settings.audio.micMuted ? 0 : settings.audio.micVolume,
      systemVolume: settings.audio.systemMuted ? 0 : settings.audio.systemVolume,
    };
  });
}

/**
 * The recorded dimensions of each source.
 *
 * Taken from the media itself where the probe found it, because the plan's
 * geometry depends on the real pixel size rather than on what the recorder
 * believed it wrote.
 */
function sourceSizes(session: EditorSession) {
  const find = (kind: TrackKind) => {
    const track = session.media.find((candidate) => candidate.kind === kind);
    return track?.width && track.height ? { width: track.width, height: track.height } : null;
  };

  return { screen: find("screen"), camera: find("camera") };
}

/** Per-track offsets, from the manifest — the only place they are recorded. */
function offsetsOf(session: EditorSession): Record<TrackKind, number> {
  const offsets: Record<TrackKind, number> = {
    screen: 0,
    camera: 0,
    microphone: 0,
    system_audio: 0,
  };

  for (const track of session.media) offsets[track.kind] = track.offset;
  return offsets;
}
