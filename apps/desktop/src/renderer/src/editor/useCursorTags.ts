/**
 * Keeping a recording's pointer name tags drawn and on disk.
 *
 * One bitmap per distinct (colour, name) the project names — the defaults and
 * every clip that overrides its pointer — rasterised once, written into the
 * recording so the exporter can read it, and handed to the preview's image
 * map so it never has to. The map it returns is keyed by `cursorTagKey`, and
 * `tagFor` is how the two plan builders look a clip's tag up in it.
 *
 * The name field dispatches on every keystroke, so the work is debounced:
 * drawing a tag per letter would be a write per letter, and main would skip
 * most of them anyway.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { cursorTag, type EditorSession } from "../../../shared/contract";
import type { CursorTag } from "../../../shared/layout";
import type { LayoutSettings, Project } from "../../../shared/project";
import type { Images } from "./canvas";
import { slicesOf } from "./state";
import { cursorTagKey, cursorTagPath, rasteriseTag, trimName } from "./cursorTag";

/** How long the name has to hold still before it is drawn. */
const SETTLE_MS = 250;

export type CursorTags = ReadonlyMap<string, CursorTag>;

const NONE: CursorTags = new Map();

/** The tag a clip's pointer wears, or undefined for a style without one or an empty name. */
export function tagFor(
  layout: Pick<LayoutSettings, "cursorStyle" | "cursorName">,
  tags: CursorTags,
): CursorTag | undefined {
  const colour = cursorTag(layout.cursorStyle);
  const name = trimName(layout.cursorName);
  if (!colour || !name) return undefined;
  return tags.get(cursorTagKey(colour, name));
}

export function useCursorTags(
  session: EditorSession | null,
  project: Project,
  setImages: (update: (images: Images) => Images) => void,
): CursorTags {
  const [tags, setTags] = useState<CursorTags>(NONE);
  /** Drawn already, by key. Kept across renders so a name typed and retyped is drawn once. */
  const drawn = useRef(new Map<string, CursorTag>());

  // Every (colour, name) the project asks for, as one string, so the effect
  // runs when a tag would change and not when anything else in the project
  // does.
  const wanted = useMemo(() => {
    const pairs = new Map<string, { colour: string; name: string }>();
    const add = (layout: Partial<LayoutSettings> | undefined, defaults: LayoutSettings) => {
      const style = layout?.cursorStyle ?? defaults.cursorStyle;
      const name = trimName(layout?.cursorName ?? defaults.cursorName);
      const colour = cursorTag(style);
      if (colour && name) pairs.set(cursorTagKey(colour, name), { colour, name });
    };
    add(undefined, project.defaults.layout);
    for (const slice of slicesOf(project)) add(slice.overrides.layout, project.defaults.layout);
    return [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [project]);
  const signature = wanted.map(([key]) => key).join(",");

  useEffect(() => {
    const dir = session?.dir;
    if (!dir || wanted.length === 0) return;

    const missing = wanted.filter(([key]) => !drawn.current.has(key));
    if (missing.length === 0) {
      setTags(new Map(drawn.current));
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const images = new Map<string, ImageBitmap>();
        for (const [key, { colour, name }] of missing) {
          if (cancelled) return;
          try {
            const tag = await rasteriseTag(colour, name);
            const path = cursorTagPath(key);
            const wrote = await window.prequel.editor.bitmaps.write("cursor", dir, path, tag.bytes);
            if (cancelled) return;
            // A tag that could not be written is still drawn in the preview;
            // the export would draw nothing there, which is a plainer video,
            // and the warning is main's.
            if (!wrote.ok || wrote.value === null) {
              console.warn(`[editor] could not write the pointer tag ${path}`);
            }
            drawn.current.set(key, { path, ...tag.placement });
            images.set(path, tag.image);
          } catch (cause) {
            console.warn(`[editor] could not draw the pointer tag for ${name}:`, cause);
          }
        }
        if (cancelled) return;

        // Adds only, like the caption images: the pointers and backgrounds in
        // the map belong to `useEditorImages`.
        setImages((current) => {
          const next = new Map(current);
          for (const [path, image] of images) next.set(path, image);
          return next;
        });
        setTags(new Map(drawn.current));
      })();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `signature` is the dependency `wanted` stands for — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.dir, signature, setImages]);

  return tags;
}
