/**
 * Starting an export, and following it.
 *
 * The plan for each slice is built here from the same `buildRenderPlan` the
 * preview draws with, so the exporter receives geometry rather than settings —
 * see `shared/layout.ts` for why that matters.
 */
import { useCallback, useEffect, useState } from "react";

import type { EditorSession, ExportProgress, ExportSlice } from "../../../shared/contract";
import { buildRenderPlan, type Size } from "../../../shared/layout";
import type { TrackKind } from "../../../shared/manifest";
import { resolveSettings, type Project } from "../../../shared/project";
import { slicesOf } from "./state";

export interface ExportState {
  progress: ExportProgress | null;
  running: boolean;
  start: () => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
}

export function useExport(session: EditorSession | null, project: Project): ExportState {
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  useEffect(() => window.prequel.editor.export.onProgress(setProgress), []);

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

    const result = await window.prequel.editor.export.start({
      dir: session.dir,
      width: project.frame.width,
      height: project.frame.height,
      fps: project.output.fps,
      codec: project.output.codec,
      slices: buildSlices(session, project),
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
  }, [session, project]);

  const cancel = useCallback(() => void window.prequel.editor.export.cancel(), []);

  return {
    progress,
    running:
      progress !== null &&
      (progress.stage === "preparing" ||
        progress.stage === "rendering" ||
        progress.stage === "finalising"),
    start,
    cancel,
    dismiss: () => setProgress(null),
  };
}

/** Resolves every slice into geometry and gain the exporter can render. */
function buildSlices(session: EditorSession, project: Project): ExportSlice[] {
  const frame: Size = { width: project.frame.width, height: project.frame.height };
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
