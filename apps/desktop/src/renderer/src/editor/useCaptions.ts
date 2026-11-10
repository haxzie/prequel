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
import type { CueLayer, RenderedCue, Size } from "../../../shared/layout";
import { captionLook, resolveSettings, type Project } from "../../../shared/project";
import type { Transcript } from "../../../shared/transcript";
import { cueKey, cuePath, measureCue } from "./captionBitmap";
import CaptionWorker from "./captionWorker?worker";
import type { DrawReply, DrawRequest, DrawnCue } from "./captionWorker";
import { captionFont } from "./controls/fonts";
import { survivingWords } from "./captionText";
import { placedSlices, slicesOf } from "./state";

/**
 * How long the settings have to hold still before anything is drawn.
 *
 * Long enough that a slider drag draws once rather than sixty times a second,
 * short enough that picking a font is not a wait. It used to be 250, which is
 * a quarter of a second of nothing happening on top of the drawing itself —
 * and a change that takes half a second to appear reads as one that did not
 * register.
 */
const SETTLE_MS = 120;

/**
 * How many cues are drawn before the preview is told about them.
 *
 * The whole reason a redraw is not one job any more. A twenty-minute
 * recording is hundreds of cues in most looks and thousands in the one that
 * shows a word at a time, and publishing only at the end meant a font change
 * showed the *old* font until every one of them had been drawn.
 *
 * Twenty-four is about a second of speech either side of the playhead. Small
 * enough that the first chunk lands immediately, large enough that the IPC
 * write it batches is worth batching.
 */
const CHUNK = 24;

/**
 * How often the preview is told about new cues, at most.
 *
 * Publishing every chunk was the obvious thing and the wrong one: a long
 * recording is over a hundred chunks, and each one is a `setState` that
 * re-renders the editor. A hundred renders in a burst is the jank this was
 * supposed to remove, arriving from the other direction.
 *
 * So the first chunk goes out immediately — that is the whole point, the cues
 * under the playhead appearing at once — and the rest are collected until this
 * much time has passed. The last one always goes out whatever the clock says.
 */
const PUBLISH_MS = 200;

/** Request ids, so a reply can be matched to the chunk that asked for it. */
let request = 0;
function nextRequest(): number {
  request += 1;
  return request;
}

/**
 * Asks the worker for one chunk and waits for that chunk's reply.
 *
 * Matched by id rather than by taking the next message: chunks are awaited one
 * at a time today, but a reply arriving for an abandoned redraw would
 * otherwise be read as this one's.
 */
function ask(thread: Worker, message: DrawRequest): Promise<(DrawnCue | null)[]> {
  return new Promise((resolve) => {
    const listen = (event: MessageEvent<DrawReply>) => {
      if (event.data.id !== message.id) return;
      thread.removeEventListener("message", listen);
      resolve(event.data.drawn);
    };
    thread.addEventListener("message", listen);
    thread.postMessage(message);
  });
}

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
  /**
   * Where the playhead is, in source time, or null before the media is ready.
   *
   * Only ever read to decide what to draw *first*. A redraw of a long
   * recording is thousands of cues and the one that matters is the one on
   * screen, so the order is by distance from here — see `draw`. Read through a
   * ref, never depended on: this changes sixty times a second during playback
   * and nothing about the pixels depends on it.
   */
  playhead: () => number | null = () => null,
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

  /**
   * The words that still play, grouped afresh whenever a cut moves.
   *
   * Cues are grouped from these rather than from every word, because a cue is
   * one bitmap: a sentence with "um, you know" cut out of the middle would
   * otherwise keep drawing the whole sentence, cut words included, over the
   * footage either side of the cut. The per-frame lookup only decides *when*
   * a bitmap shows, never what is in it.
   */
  /**
   * The cuts, as a string.
   *
   * Every dispatch hands this hook a fresh project object — dragging a slider
   * in the inspector produces one per `pointermove` — but the only thing
   * `survivingWords` reads from it is where the clips start and end. Keyed on
   * the project, a layout drag rescanned the whole transcript on every pointer
   * event; keyed on this, it rescans when a cut actually moves.
   *
   * The same reasoning `Editor` gives for keying its own word list on the
   * slices rather than the project.
   */
  const cuts = slicesOf(project)
    .map(
      (slice) =>
        // The holes as well as the edges. A sentence stepped over inside a clip
        // moves every cue after it, and keyed on the edges alone the whole set
        // would keep the timings it had before the cut.
        `${slice.source.start}-${slice.source.end}` +
        (slice.skips ?? []).map((skip) => `/${skip.start}-${skip.end}`).join(""),
    )
    .join(",");

  const spoken = useMemo(
    () => (transcript ? survivingWords(transcript.words, placedSlices(project)).visible : null),
    // `project` is read inside but deliberately not depended on: `cuts` is
    // derived from it and covers everything this reads, so a project that
    // produces the same cuts produces the same words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transcript, cuts],
  );

  // Joined rather than passed as an object: the effect must re-run when a look
  // changes, and a fresh project object arrives on every unrelated edit. The
  // clip layout is in it because the words above depend on it.
  const signature = [
    session?.dir ?? "",
    Math.round(frame.width),
    Math.round(frame.height),
    [...looks.keys()].sort().join(","),
    cuts,
  ].join("|");

  const latest = useRef({ looks, spoken, frame, playhead });
  latest.current = { looks, spoken, frame, playhead };

  /**
   * The thread the pixels are painted on.
   *
   * One for the hook's whole life rather than one per redraw: starting a
   * worker costs a module load, and a redraw happens on every settled
   * keystroke of a slider.
   */
  const worker = useRef<Worker | null>(null);
  useEffect(() => {
    const thread = new CaptionWorker();
    worker.current = thread;
    return () => {
      thread.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    const dir = session?.dir;
    if (!dir || latest.current.looks.size === 0 || !latest.current.spoken) {
      setByLook(NONE);
      setDrawing(false);
      return;
    }

    let cancelled = false;
    setDrawing(true);

    const timer = setTimeout(() => {
      void (async () => {
        // `drawing` is what the export waits on before it builds its plan —
        // see `settled` in `useExport.ts` — so every way out of this has to put
        // it back. It used to be cleared on the one path where the whole draw
        // finished, which meant an abandoned run, or anything thrown out here
        // rather than inside the per-cue `try`, left the flag raised with
        // nothing left to lower it. The export then waited on it for ever:
        // the save dialog closed, "preparing" stayed on screen, and nothing
        // was ever sent to main — a freeze with not one line in the log.
        try {
          await draw(dir);
        } finally {
          setDrawing(false);
        }
      })();

      async function draw(into: string) {
        const { looks: pending, spoken: words, frame: size, playhead: at } = latest.current;
        if (!words) return;

        const thread = worker.current;
        if (!thread) return;

        const drawn = new Map<string, RenderedCue[]>();
        const written: string[] = [];

        // Published as it goes, so the preview does not wait for the whole
        // recording. `byLook` is replaced with a fresh map each time rather
        // than mutated, because React compares by identity and a mutated map
        // is a redraw nobody sees.
        let published = 0;
        const publish = (force: boolean) => {
          const now = performance.now();
          if (!force && published !== 0 && now - published < PUBLISH_MS) return;
          published = now;

          const snapshot = new Map<string, readonly RenderedCue[]>();
          for (const [look, set] of drawn) snapshot.set(look, [...set]);
          setByLook(snapshot);
        };

        // The look on screen before the others. Every one of them is drawn in
        // the end, but a recording usually has one look across every clip and
        // the preview can only ever show one — so whichever that is goes
        // first, and the rest fill in behind it.
        const order = [...pending];

        for (const [look, current] of order) {
          const style = captionStyle(current.captionStyle);
          const options = {
            frame: size,
            size: current.captionSize,
            accent: current.captionAccent,
            family: captionFont(current.captionFont).stack,
          };
          // Grouped per look, because the line budget is one of the settings a
          // clip can override and it decides where a cue breaks.
          const cues: Cue[] = cuesFrom(words, {
            lines: current.captionLines,
            // A look that swells the word it lights needs one word to a cue, or
            // the swollen one lands on its neighbours.
            perWord: style.perWord,
          });

          const set: RenderedCue[] = [];
          drawn.set(look, set);

          // What each cue is called and where its words sit, worked out
          // without painting anything. `measureCue` is the cheap half of the
          // rasteriser — no canvas, no PNG — and it is all that is needed to
          // *place* a cue whose bitmaps are already on disk.
          const named = cues.map((cue) => {
            const key = cueKey(cue, style, options);
            const measured = measureCue(cue, style, options);
            return {
              cue,
              key,
              measured,
              paths: measured.layers.map((layer) => cuePath(key, layer.name)),
            };
          });

          // Which bitmaps are already on disk. One round trip for the lot:
          // `writeBitmap` has always skipped a file that is there, but only
          // after this side had painted it, encoded a PNG and shipped it — so
          // a second redraw of the same look cost everything the first did and
          // changed nothing. Asking first is what makes re-opening a project,
          // or turning a setting back, free.
          const have = await window.prequel.editor.bitmaps.have(
            "captions",
            into,
            named.flatMap((one) => one.paths),
          );
          if (cancelled) return;
          const onDisk = new Set(have.ok ? have.value : []);

          /** Everything needed to put a cue in the plan, drawn or skipped. */
          const place = (one: (typeof named)[number]): RenderedCue => ({
            at: one.cue.at,
            end: one.cue.end,
            layers: one.measured.layers.map((layer, which) => ({
              path: one.paths[which]!,
              words: layer.words,
            })),
            bitmap: one.measured.layout.bitmap,
            size: one.measured.layout.size,
            // What the bitmaps were measured at, so a set drawn for one size
            // can stand in — scaled — for one still being drawn at another.
            // See `RenderedCue.drawnSize`.
            drawnSize: current.captionSize,
          });

          // Nearest the playhead first. A redraw is thousands of cues and the
          // only one anybody is looking at is the one under the playhead, so
          // the order is by distance from it — and with each chunk published
          // as it lands, a font change shows on screen in a chunk's time
          // rather than the whole recording's.
          const here = at() ?? 0;
          const queue = [...named].sort(
            (a, b) => Math.abs(a.cue.at - here) - Math.abs(b.cue.at - here),
          );

          for (let from = 0; from < queue.length; from += CHUNK) {
            // Checked between chunks rather than only at the end: a settings
            // change part way through should abandon the rest rather than
            // finish drawing the old look.
            if (cancelled) return;

            const chunk = queue.slice(from, from + CHUNK);

            // The ones already written are placed and nothing else. They still
            // have to be *kept*, though — a path left out of `written` is one
            // the sweep below deletes, which would throw away the very bitmaps
            // this skipped drawing.
            const missing: typeof chunk = [];
            for (const one of chunk) {
              if (one.paths.every((path) => onDisk.has(path))) {
                written.push(...one.paths);
                set.push(place(one));
              } else {
                missing.push(one);
              }
            }

            if (missing.length > 0) {
              const replies = await ask(thread, {
                id: nextRequest(),
                cues: missing.map((one) => one.cue),
                style,
                options,
                // Empty for captions: every face in `CAPTION_FONTS` is one
                // macOS ships, so the worker's own font set already has it.
                // The worker takes them because a hosted face would not be
                // there, and nothing about this is caption-specific.
                faces: [],
              });
              if (cancelled) return;

              // One round trip for the chunk rather than one per layer. The
              // IPC — serialise, switch, write, reply — was costing more than
              // the drawing it carried: a long recording is thousands of
              // layers, each its own `invoke`, strictly one after another.
              const batch: { file: string; bytes: Uint8Array }[] = [];
              const owners: { one: (typeof missing)[number]; count: number }[] = [];

              replies.forEach((result, index) => {
                const one = missing[index];
                if (!one || !result) return;
                result.layers.forEach((layer, which) =>
                  batch.push({ file: one.paths[which]!, bytes: layer.bytes }),
                );
                owners.push({ one, count: result.layers.length });
              });

              if (batch.length > 0) {
                const wrote = await window.prequel.editor.bitmaps.writeMany(
                  "captions",
                  into,
                  batch,
                );
                if (cancelled) return;
                const landed = wrote.ok ? wrote.value : [];

                let taken = 0;
                for (const owner of owners) {
                  const mine = landed.slice(taken, taken + owner.count);
                  taken += owner.count;
                  // The layer underneath is the line itself, and every layer
                  // above it is a word cropped out of a picture that has to be
                  // there. So one that will not write takes the whole cue with
                  // it rather than leaving a word or two floating on the
                  // footage.
                  if (mine.length !== owner.count || mine.some((file) => file === null)) continue;
                  written.push(...owner.one.paths);
                  set.push(place(owner.one));
                }
              }
            }

            // In source order before it goes out: `rectAt` and the image
            // window both walk these expecting time to run forwards, and the
            // queue above deliberately does not.
            set.sort((a, b) => a.at - b.at);
            publish(false);
          }
        }

        if (cancelled) return;
        publish(true);

        // After the new sets are live, so a sweep can never delete a bitmap the
        // plan is about to name.
        void window.prequel.editor.bitmaps.sweep("captions", into, written);
      }
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `latest` carries the values; the signature is what decides to re-run.
    // The transcript is a dependency in its own right rather than part of the
    // signature: it used to be keyed by its word count, and a word retyped to
    // one of the same length — "teh" to "the" — never redrew.
  }, [signature, session?.dir, transcript]);

  return { byLook, drawing };
}
