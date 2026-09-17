/**
 * Keeping a recording's text bitmaps in step with its texts.
 *
 * `useCaptions` for titles: every field of every text is drawn once, at the
 * export frame's size, written into the recording, and handed back as what
 * `buildRenderPlan` needs to place it. Debounced for the same reason — a
 * size slider is a 60 Hz stream of edits — and cheap when nothing that
 * changes the pixels changed, because a field's file is named by a hash of
 * everything they depend on and main skips a write it has already done.
 *
 * Fonts are the one thing captions never had to wait for. A hosted face
 * arrives over the network, and a canvas asked to draw in a face that is not
 * there yet draws the fallback and says nothing — so every field waits for
 * its face before it is measured, and one drawn in the fallback anyway is
 * named as such and redrawn when the face lands.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { EditorSession } from "../../../shared/contract";
import type { RenderedText, RenderedTextField, Size } from "../../../shared/layout";
import type { Project, TextSlice } from "../../../shared/project";
import { finerUnit, unitKindFor } from "../../../shared/text-motion";
import type { Fonts } from "./useFonts";
import { rasteriseField, textFieldKey, textPath } from "./textBitmap";

/** How long the texts have to hold still before anything is drawn. The same
    settle captions use, for the same reason. */
const SETTLE_MS = 120;

export interface TextBitmaps {
  /** By text id. A text missing from here has nothing to draw yet. */
  rendered: ReadonlyMap<string, RenderedText>;
  /** True while bitmaps are being drawn, so an export can wait for them. */
  drawing: boolean;
}

const NONE: ReadonlyMap<string, RenderedText> = new Map();

export function useTextBitmaps(
  session: EditorSession | null,
  project: Project,
  frame: Size,
  fonts: Fonts,
): TextBitmaps {
  const [rendered, setRendered] = useState<ReadonlyMap<string, RenderedText>>(NONE);
  const [drawing, setDrawing] = useState(false);

  /**
   * Every field's name, which is everything the pixels depend on.
   *
   * Joined into one string so the effect re-runs when a picture would change
   * and not when a text is moved, trimmed or re-timed — a fresh project object
   * arrives on every one of those, and redrawing every title for a drag along
   * the timeline is the settle doing nothing useful.
   */
  const texts = useMemo(() => project.texts.flatMap((track) => track.slices), [project.texts]);
  const signature = texts
    .map((text) => `${text.id}:${keysOf(text, frame, fonts).join(",")}`)
    .join("|");

  const latest = useRef({ texts, frame, fonts });
  latest.current = { texts, frame, fonts };

  useEffect(() => {
    const dir = session?.dir;
    if (!dir || latest.current.texts.length === 0) {
      setRendered(NONE);
      setDrawing(false);
      return;
    }

    let cancelled = false;
    setDrawing(true);

    const timer = setTimeout(() => {
      void (async () => {
        const { texts: pending, frame: size, fonts: faces } = latest.current;
        const drawn = new Map<string, RenderedText>();
        const written: string[] = [];
        // Fields already drawn this pass, by name: two texts with the same
        // heading share a file, and drawing it twice is a wasted rasterise
        // and a second identical write main would skip anyway.
        const done = new Map<string, RenderedTextField>();

        for (const text of pending) {
          if (cancelled) return;
          const unit = finerUnit(unitKindFor(text.enter), unitKindFor(text.exit));
          const fields: RenderedTextField[] = [];

          for (const field of text.fields) {
            try {
              // The face first, so the key below says truthfully whether it
              // was there. Nothing is measured until this settles.
              const fontLoaded = await faces.ready(field.style);
              if (cancelled) return;

              const options = {
                frame: size,
                family: faces.stack(field.style.font),
                unit,
                wrap: text.width * size.width,
                align: text.align,
                fontLoaded,
              };
              const key = textFieldKey(field, options);
              const path = textPath(key);

              const shared = done.get(path);
              if (shared) {
                fields.push({ ...shared, drawnSize: field.style.size });
                continue;
              }

              const { layout, bytes } = await rasteriseField(field, options);
              const wrote = await window.prequel.editor.bitmaps.write("texts", dir, path, bytes);
              // A field that will not write takes the whole text with it
              // rather than leaving a subtitle floating under a missing
              // title.
              if (!wrote.ok || wrote.value === null) {
                fields.length = 0;
                break;
              }
              written.push(path);

              const entry: RenderedTextField = {
                path,
                bitmap: layout.bitmap,
                extent: layout.extent,
                units: layout.units,
                fontSize: layout.fontSize,
                drawnFrame: size,
                drawnSize: field.style.size,
              };
              done.set(path, entry);
              fields.push(entry);
            } catch (cause) {
              // One field that would not draw is one missing line. The rest
              // of the recording is still worth its titles.
              console.warn("[texts] could not draw a field:", cause);
              fields.length = 0;
              break;
            }
          }

          if (fields.length === text.fields.length) drawn.set(text.id, { fields });
        }

        if (cancelled) return;

        setRendered(drawn);
        setDrawing(false);

        // After the new set is live, so a sweep can never delete a bitmap the
        // plan is about to name.
        void window.prequel.editor.bitmaps.sweep("texts", dir, written);
      })();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `latest` carries the values; the signature is what decides to re-run.
    // The font catalogue's arrival is a dependency in its own right: a face
    // that could not be found when a field was first drawn may be there now.
  }, [signature, session?.dir, fonts.version]);

  return { rendered, drawing };
}

/** The names a text's fields would be drawn under, for the signature. */
function keysOf(text: TextSlice, frame: Size, fonts: Fonts): string[] {
  const unit = finerUnit(unitKindFor(text.enter), unitKindFor(text.exit));
  return text.fields.map((field) =>
    textFieldKey(field, {
      frame,
      family: fonts.stack(field.style.font),
      unit,
      wrap: text.width * frame.width,
      align: text.align,
      fontLoaded: fonts.loaded(field.style),
    }),
  );
}
