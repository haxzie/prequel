/**
 * Keeping a recording's shortcut bitmaps in step with its settings.
 *
 * `useCursorTags` for key caps: every distinct chord the recording saw is
 * drawn once, written into the recording and handed back as what
 * `buildRenderPlan` needs to place it. Distinct by what the *pixels* depend on
 * — the caps, the dressing, the face — so a recording with forty ⌘S in it
 * draws one bitmap, and moving the row across the frame redraws nothing.
 *
 * Nothing is drawn while the row is switched off, which is the common case: a
 * recording keeps its chords whether or not anybody wants them on the picture,
 * and rasterising forty bitmaps for a video that will never show one is work
 * nobody asked for.
 *
 * Fonts are waited for, like the texts': a canvas asked to draw in a face that
 * has not arrived draws the fallback and says nothing, so a chord drawn before
 * its face lands is named as a fallback and redrawn when it does.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { EditorSession } from "../../../shared/contract";
import type { RenderedChord } from "../../../shared/layout";
import { KEY_FONT, keyLooks, keyPlate } from "../../../shared/keystrokes";
import type { LayoutSettings, Project } from "../../../shared/project";
import { chordBitmap, chordKey, chordPath, rasteriseChord, type ChordStyle } from "./keyBitmap";
import { slicesOf } from "./state";
import type { Images } from "./webgl";
import type { Fonts } from "./useFonts";

/** How long the settings have to hold still before anything is drawn. The same
    settle the captions and texts use, for the same reason. */
const SETTLE_MS = 120;

export interface Keystrokes {
  /** Ready to place, in the recording's own clock. Empty draws nothing. */
  chords: readonly RenderedChord[];
  /** True while bitmaps are being drawn, so an export can wait for them. */
  drawing: boolean;
}

const NONE: readonly RenderedChord[] = [];

export function useKeystrokes(
  session: EditorSession | null,
  project: Project,
  fonts: Fonts,
  setImages: (update: (images: Images) => Images) => void,
): Keystrokes {
  const [chords, setChords] = useState<readonly RenderedChord[]>(NONE);
  const [drawing, setDrawing] = useState(false);
  /** Drawn already, by key. Kept across renders so a style toggled and back is drawn once. */
  const drawn = useRef(new Set<string>());
  /**
   * The last row that was actually drawn, to hold on screen while the next one
   * is being made.
   *
   * Restyling renames every bitmap — the name is a hash of everything the
   * pixels depend on — so the chords in hand are tagged with the look that has
   * just been left, and `keystrokeItems` matches on the look in force. Without
   * this the row *vanishes* the instant the colour or the plate is touched and
   * stays gone for as long as a slider is moving, because the redraw is
   * debounced and the drag keeps resetting it.
   *
   * The same answer the captions give — see `stale` in `Preview.tsx`: hold the
   * pixels you have until the new ones land. An export cannot catch the stale
   * ones, because it waits on `drawing`.
   */
  const stale = useRef<readonly RenderedChord[]>(NONE);

  /**
   * Every look the recording actually asks for.
   *
   * The defaults' where they switch the row on, and each clip's where *it*
   * does — because that is how somebody uses this: select a clip, turn
   * shortcuts on, style them there. Reading only the defaults drew nothing at
   * all for exactly that, which is the way this first shipped and the way it
   * was first reported broken.
   *
   * Usually one entry, and often none. A clip that sets no style of its own
   * resolves to the defaults', so two clips with the row on and nothing else
   * changed share one set of bitmaps rather than drawing two.
   */
  const looks = useMemo(() => {
    const scopes = [
      project.defaults.layout,
      ...slicesOf(project).map((slice) => ({
        ...project.defaults.layout,
        ...slice.overrides.layout,
      })),
    ];

    return new Map(
      [...keyLooks(scopes)].map(([id, layout]): [string, ChordStyle] => [
        id,
        {
          plate: keyPlate(layout.keysPlate),
          color: layout.keysColor,
          opacity: layout.keysOpacity,
          family: fonts.stack(KEY_FONT),
        },
      ]),
    );
  }, [project, fonts]);

  /**
   * One rasterising job per chord per look: the caps, the look to draw them
   * in, and the name that is both the file and the tag the plan picks it by.
   */
  const wanted = useMemo(() => {
    const seen = new Map<
      string,
      { keys: string[]; key: string; look: string; style: ChordStyle }
    >();
    for (const chord of session?.shortcuts ?? []) {
      if (chord.keys.length === 0) continue;
      for (const [look, style] of looks) {
        const key = chordKey(chord.keys, style);
        if (!seen.has(key)) seen.set(key, { keys: chord.keys, key, look, style });
      }
    }
    return [...seen.values()];
  }, [session, looks]);

  const signature = wanted.map((chord) => chord.key).join(",");

  useEffect(() => {
    const dir = session?.dir;
    if (!dir || wanted.length === 0) {
      setChords(NONE);
      setDrawing(false);
      return;
    }

    // What is on screen until the new bitmaps are ready: the last row drawn,
    // re-tagged to the look now in force. Wrong by the width of a restyle —
    // the pixels are the old ones — and the alternative is no row at all.
    //
    // The first look where there are two, which is one more than a drag ever
    // produces: the id only moves because a control moved, and a control moves
    // in one scope at a time.
    const holding = [...looks.keys()][0];
    if (holding !== undefined && stale.current.length > 0) {
      setChords(stale.current.map((chord) => ({ ...chord, style: holding })));
    }

    let cancelled = false;
    setDrawing(true);
    const timer = setTimeout(() => {
      void (async () => {
        const images = new Map<string, ImageBitmap>();

        for (const chord of wanted) {
          if (cancelled) return;
          const path = chordPath(chord.key);
          if (drawn.current.has(chord.key)) continue;

          try {
            const bytes = await rasteriseChord(chord.keys, chord.style);
            const wrote = await window.prequel.editor.bitmaps.write("keys", dir, path, bytes);
            if (cancelled) return;
            // One that could not be written is still drawn in the preview; the
            // export would draw nothing there, which is a plainer video, and
            // the warning is main's.
            if (!wrote.ok || wrote.value === null) {
              console.warn(`[editor] could not write the shortcut ${path}`);
            }
            drawn.current.add(chord.key);
            const blob = new Blob([bytes as BlobPart], { type: "image/png" });
            images.set(path, await createImageBitmap(blob));
          } catch (cause) {
            console.warn(`[editor] could not draw the shortcut ${chord.keys.join(" ")}:`, cause);
          }
        }
        if (cancelled) return;

        // Adds only, like the pointer tags: the backgrounds and frames in the
        // map belong to `useEditorImages`.
        if (images.size > 0) {
          setImages((current) => {
            const next = new Map(current);
            for (const [path, image] of images) next.set(path, image);
            return next;
          });
        }

        // Every press in every look, not just the distinct ones: the bitmaps
        // are shared and the *placements* are not — forty ⌘S are forty
        // moments, and a clip wearing a second look needs its own copy of each
        // of them for `keystrokeItems` to pick out.
        const byKeys = new Map<string, { key: string; look: string }[]>();
        for (const chord of wanted) {
          const caps = chord.keys.join(" ");
          byKeys.set(caps, [...(byKeys.get(caps) ?? []), { key: chord.key, look: chord.look }]);
        }

        const next = (session.shortcuts ?? []).flatMap((chord): RenderedChord[] =>
          (byKeys.get(chord.keys.join(" ")) ?? [])
            .filter((drawnLook) => drawn.current.has(drawnLook.key))
            .map((drawnLook) => ({
              at: chord.at,
              style: drawnLook.look,
              path: chordPath(drawnLook.key),
              bitmap: chordBitmap(chord.keys),
            })),
        );
        stale.current = next;
        setChords(next);
        // The chords nothing refers to any more, which after a style change
        // is every one of the old ones. Swept here for the reason the texts
        // are: a recording whose row has been restyled a dozen times would
        // otherwise carry a dozen sets of bitmaps it will never draw.
        void window.prequel.editor.bitmaps.sweep(
          "keys",
          dir,
          wanted.map((chord) => chordPath(chord.key)),
        );

        setDrawing(false);
      })();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      setDrawing(false);
      clearTimeout(timer);
    };
    // `signature` stands in for `wanted`, which is a new array on every
    // render: the effect must run when the *set* changes and not before. The
    // face needs no such guard, because the only one a cap is drawn in is the
    // system's and it is always there — see `KEY_FONT`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, signature, setImages]);

  return { chords, drawing };
}

/**
 * The leaves the row reads, for a clip.
 *
 * The defaults' style is what every chord is *drawn* in — see `style` above —
 * and these are what `layout.ts` places with, which a clip may override: where
 * the row sits and how big it is move pixels rather than redrawing them.
 */
export function keystrokesFor(layout: LayoutSettings): boolean {
  return layout.keysVisible;
}
