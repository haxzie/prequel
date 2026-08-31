/**
 * Keeping a recording's caption bitmaps in step with its settings.
 *
 * The transcript is words and times; the plan wants pictures. This is the step
 * between: group the words into cues, draw each one, write it into the
 * recording, and hand back what `buildRenderPlan` needs to place them.
 *
 * Caption settings are per clip, like every other section — so this draws one
 * set of bitmaps per distinct *look* rather than one for the whole recording.
 * Two clips that agree on the style, size, accent and line budget share a set;
 * two that disagree get their own. Position and visibility are not part of that
 * signature, because neither changes a pixel: moving the captions up the frame
 * re-places bitmaps that are already on disk.
 *
 * Everything is drawn against the *export* frame, never the preview's, so one
 * set serves both and the preview only ever samples down.
 *
 * Debounced, because a size slider is a 60 Hz stream of edits and each one
 * would otherwise redraw every cue. Cheap when nothing that changes the pixels
 * changed: the file name is a hash of everything they depend on, so main skips
 * a write it has already done.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { captionStyle, cuesFrom, type Cue } from "../../../shared/captions";
import type { EditorSession } from "../../../shared/contract";
import type { RenderedCue, Size } from "../../../shared/layout";
import { captionLook, resolveSettings, type Project } from "../../../shared/project";
import type { Transcript } from "../../../shared/transcript";
import { cueKey, cuePaths, rasteriseCue } from "./captionBitmap";
import { slicesOf } from "./state";

/** How long the settings have to hold still before anything is drawn. */
const SETTLE_MS = 250;

export interface Captions {
  /**
   * Bitmaps by look, so a clip can find the set drawn for its own settings.
   *
   * Keyed by `captionLook` rather than by clip id: most recordings have one
   * look across every clip, and keying by clip would draw the same cue as many
   * times as there are cuts.
   */
  byLook: ReadonlyMap<string, readonly RenderedCue[]>;
  /** True while bitmaps are being drawn, so an export can wait for them. */
  drawing: boolean;
}

/** Nothing to draw. A shared constant so a caller can compare by identity. */
const NONE: ReadonlyMap<string, readonly RenderedCue[]> = new Map();

export function useCaptions(
  session: EditorSession | null,
  /**
   * The transcript in force, which is *not* `session.transcript`.
   *
   * The session is a snapshot taken when the editor opened, so on a recording
   * that had no transcript then it is null and stays null — a freshly generated
   * one arrives on the progress channel instead. Reading it off the session was
   * exactly that bug: the words were written to disk, captions were switched
   * on, and nothing was ever drawn until the recording was reopened.
   */
  transcript: Transcript | null,
  project: Project,
  frame: Size,
): Captions {
  const [byLook, setByLook] = useState<ReadonlyMap<string, readonly RenderedCue[]>>(NONE);
  const [drawing, setDrawing] = useState(false);

  /**
   * Every distinct look this project asks for, and the settings behind it.
   *
   * The defaults are in here even when every clip overrides them: a clip added
   * later inherits them, and drawing one extra set is cheaper than a preview
   * that is blank until the next edit.
   */
  const looks = useMemo(() => {
    const wanted = new Map<string, ReturnType<typeof resolveSettings>["captions"]>();
    if (!transcript) return wanted;

    const add = (captions: ReturnType<typeof resolveSettings>["captions"]) => {
      if (captions.captionsOn) wanted.set(captionLook(captions), captions);
    };

    add(project.defaults.captions);
    for (const slice of slicesOf(project)) {
      add(resolveSettings(project.defaults, slice.overrides).captions);
    }

    return wanted;
  }, [transcript, project]);

  // Joined rather than passed as an object: the effect must re-run when a look
  // changes, and a fresh project object arrives on every unrelated edit.
  const signature = [
    session?.dir ?? "",
    transcript?.words.length ?? 0,
    Math.round(frame.width),
    Math.round(frame.height),
    [...looks.keys()].sort().join(","),
  ].join("|");

  const latest = useRef({ looks, transcript, frame });
  latest.current = { looks, transcript, frame };

  useEffect(() => {
    const dir = session?.dir;
    if (!dir || latest.current.looks.size === 0 || !latest.current.transcript) {
      setByLook(NONE);
      setDrawing(false);
      return;
    }

    let cancelled = false;
    setDrawing(true);

    const timer = setTimeout(() => {
      void (async () => {
        const { looks: pending, transcript: words, frame: size } = latest.current;
        if (!words) return;

        const drawn = new Map<string, RenderedCue[]>();
        const written: string[] = [];

        for (const [look, current] of pending) {
          const style = captionStyle(current.captionStyle);
          const options = { frame: size, size: current.captionSize, accent: current.captionAccent };
          // Grouped per look, because the line budget is one of the settings a
          // clip can override and it decides where a cue breaks.
          const cues: Cue[] = cuesFrom(words.words, { lines: current.captionLines });
          const set: RenderedCue[] = [];

          for (const cue of cues) {
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

              set.push({
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
              console.warn("[captions] could not draw a cue:", cause);
            }
          }

          drawn.set(look, set);
        }

        if (cancelled) return;

        setByLook(drawn);
        setDrawing(false);

        // After the new sets are live, so a sweep can never delete a bitmap the
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

  return { byLook, drawing };
}
