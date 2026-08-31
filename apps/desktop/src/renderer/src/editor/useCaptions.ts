/**
 * Keeping a recording's caption bitmaps in step with its settings.
 *
 * The transcript is words and times; the plan wants pictures. This is the step
 * between: group the words into cues, draw each one, write it into the
 * recording, and hand back what `buildRenderPlan` needs to place them.
 *
 * Everything is drawn against the *export* frame, never the preview's, so one
 * set of bitmaps serves both and the preview only ever samples them down.
 *
 * Debounced, because a size slider is a 60 Hz stream of edits and each one
 * would otherwise redraw every cue in the recording. Cheap when nothing that
 * changes the pixels changed: the file name is a hash of everything they depend
 * on, so main skips a write it has already done and moving the captions up the
 * frame redraws nothing at all.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { captionStyle, cuesFrom, type Cue } from "../../../shared/captions";
import type { EditorSession } from "../../../shared/contract";
import type { RenderedCue, Size } from "../../../shared/layout";
import type { CaptionSettings } from "../../../shared/project";
import { cueKey, cuePaths, rasteriseCue } from "./captionBitmap";

/** How long the settings have to hold still before anything is drawn. */
const SETTLE_MS = 250;

export interface Captions {
  /** What to hand `buildRenderPlan`. Empty until the bitmaps are on disk. */
  cues: RenderedCue[];
  /** True while bitmaps are being drawn, so an export can wait for them. */
  drawing: boolean;
}

export function useCaptions(
  session: EditorSession | null,
  settings: CaptionSettings,
  frame: Size,
): Captions {
  const [cues, setCues] = useState<RenderedCue[]>([]);
  const [drawing, setDrawing] = useState(false);

  // Grouped separately from the drawing so a style change does not re-run the
  // grouping, and a lines change does not redraw a cue whose text is unaltered.
  const grouped = useMemo<Cue[]>(
    () =>
      session?.transcript && settings.captionsOn
        ? cuesFrom(session.transcript.words, { lines: settings.captionLines })
        : [],
    [session?.transcript, settings.captionsOn, settings.captionLines],
  );

  // Joined rather than passed as objects: the effect must re-run when a value
  // changes, and a fresh settings object arrives on every unrelated edit.
  const signature = [
    session?.dir ?? "",
    grouped.length,
    settings.captionStyle,
    settings.captionSize,
    settings.captionAccent,
    Math.round(frame.width),
    Math.round(frame.height),
  ].join("|");

  const latest = useRef({ grouped, settings, frame });
  latest.current = { grouped, settings, frame };

  useEffect(() => {
    const dir = session?.dir;
    if (!dir || latest.current.grouped.length === 0) {
      setCues([]);
      setDrawing(false);
      return;
    }

    let cancelled = false;
    setDrawing(true);

    const timer = setTimeout(() => {
      void (async () => {
        const { grouped: pending, settings: current, frame: size } = latest.current;
        const style = captionStyle(current.captionStyle);
        const options = { frame: size, size: current.captionSize, accent: current.captionAccent };

        const drawn: RenderedCue[] = [];
        const written: string[] = [];

        for (const cue of pending) {
          // Checked between cues rather than only at the end: a long recording
          // is hundreds of bitmaps, and a settings change part way through
          // should abandon the rest rather than finish drawing the old look.
          if (cancelled) return;

          try {
            const key = cueKey(cue, style, options);
            const paths = cuePaths(key);
            const { layout, flat, lit } = await rasteriseCue(cue, style, options);

            const flatOk = await window.prequel.editor.captions.write(dir, paths.flat, flat);
            if (!flatOk.ok || flatOk.value === null) continue;
            written.push(paths.flat);

            let litPath: string | null = null;
            if (lit) {
              const litOk = await window.prequel.editor.captions.write(dir, paths.lit, lit);
              if (litOk.ok && litOk.value !== null) {
                litPath = paths.lit;
                written.push(paths.lit);
              }
            }

            drawn.push({
              at: cue.at,
              end: cue.end,
              path: paths.flat,
              // Without the lit bitmap there is no lit layer to emit, so the
              // word boxes go with it — a lit item pointing at nothing draws
              // the flat bitmap's whole width as if it were one word.
              litPath,
              bitmap: layout.bitmap,
              size: layout.size,
              words: litPath ? layout.words : [],
            });
          } catch (cause) {
            // One cue that would not draw is one missing caption. The rest of
            // the recording is still worth captioning.
            console.warn(`[captions] could not draw a cue:`, cause);
          }
        }

        if (cancelled) return;

        setCues(drawn);
        setDrawing(false);

        // After the new set is live, so a sweep can never delete a bitmap the
        // plan is about to name.
        void window.prequel.editor.captions.sweep(dir, written);
      })();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `latest` carries the values; the signature is what decides to re-run.
  }, [signature, session?.dir]);

  return { cues, drawing };
}
