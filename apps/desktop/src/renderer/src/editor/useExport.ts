/**
 * Starting an export, and following it.
 *
 * The plan for each slice is built here from the same `buildRenderPlan` the
 * preview draws with, so the exporter receives geometry rather than settings —
 * see `shared/layout.ts` for why that matters.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  cursorImages,
  type EditorSession,
  type ExportProgress,
  type ExportSlice,
} from "../../../shared/contract";
import { buildRenderPlan, type Size } from "../../../shared/layout";
import type { TrackKind } from "../../../shared/manifest";
import { mediaUrl, recordingName } from "../../../shared/media-url";
import {
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
): ExportState {
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  useEffect(() => window.prequel.editor.export.onProgress(setProgress), []);

  const frame = useMemo(
    () => outputFrame(project.frame, output.shortEdge),
    [project.frame, output.shortEdge],
  );

  const start = useCallback(async () => {
    if (!session) return;

    // Shown immediately rather than waiting for the first tick from main, so
    // pressing Export cannot look like it did nothing.
    setProgress({
      stage: "preparing",
      framesDone: 0,
      framesTotal: 0,
      outputPath: null,
      error: null,
    });

    const size = outputFrame(project.frame, output.shortEdge);

    const result = await window.prequel.editor.export.start({
      dir: session.dir,
      width: size.width,
      height: size.height,
      fps: output.fps,
      format: output.format,
      // The plan is laid out inside the *export's* frame, not the editor's, so
      // a scaled-down export is the same composition rather than a crop of it.
      slices: buildSlices(session, project, size),
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
  }, [session, project, output]);

  const cancel = useCallback(() => void window.prequel.editor.export.cancel(), []);

  // Held against the progress rather than in state of its own: "done" already
  // carries the path, and a second copy could disagree with it after a retry.
  const result = useMemo((): ExportResult | null => {
    if (!session || progress?.stage !== "done" || !progress.outputPath) return null;

    const name = progress.outputPath.split("/").pop() ?? "";
    return {
      path: progress.outputPath,
      url: mediaUrl(recordingName(session.dir), name),
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

/** Resolves every slice into geometry and gain the exporter can render. */
function buildSlices(session: EditorSession, project: Project, frame: Size): ExportSlice[] {
  const sources = sourceSizes(session);

  return slicesOf(project).map((slice) => {
    const settings = resolveSettings(project.defaults, slice.overrides);

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
        },
        project.zooms,
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
