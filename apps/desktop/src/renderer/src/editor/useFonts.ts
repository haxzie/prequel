/**
 * The faces a text can be set in, hosted ones included.
 *
 * The macOS list in `controls/fonts.ts` needs nothing: the engine has those.
 * A hosted family is a catalogue entry and a file per weight, and reaching
 * one is three steps this hook owns — main fetches the file into its cache,
 * a `FontFace` is pointed at `prequel-media://font/`, and it is *loaded*
 * before anyone measures with it. The last step is the one that matters: a
 * canvas asked for a face that has not loaded draws the fallback and says
 * nothing, and `captionBitmap.ts` has the measurements of how that looked.
 *
 * The family is registered under a name of our own, `prequel-<id>`, rather
 * than the face's real name. A machine with its own "Inter" installed — a
 * different cut, different metrics — would otherwise win the match, and the
 * same project would rasterise differently on two Macs.
 *
 * Held at module level rather than per hook instance: a face is loaded once
 * per window, whichever panel asked.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FontFamilyListing, FontsCatalogue } from "../../../shared/contract";
import { fontUrl } from "../../../shared/media-url";
import type { TextStyle } from "../../../shared/project";
import { captionFont, isSystemFont } from "./controls/fonts";

/** The CSS family a hosted font is registered under. */
export function hostedFamily(id: string): string {
  return `prequel-${id}`;
}

/** What a hosted stack falls through to while the face is missing. */
const FALLBACK = "Arial, sans-serif";

/** One variant's face, and how far along it is. */
interface Loading {
  done: Promise<boolean>;
  loaded: boolean;
}

/** By `${id}:${weight}:${italic}`. */
const faces = new Map<string, Loading>();

/** Bumped whenever a face finishes, so every hook re-renders together. */
let generation = 0;
const listeners = new Set<() => void>();

function bump(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

/** The look a style asks for, as far as a family can answer it. */
export interface Want {
  font: string;
  weight: number;
  italic: boolean;
}

/**
 * The variant nearest what was asked for, or null for a family with none.
 *
 * The same slant first, then the nearest weight; only across the slant when
 * the family has none of that slant at all. Chromium would synthesise the
 * missing one, and a synthetic bold drawn into a bitmap is a different
 * picture from the real bold that arrives a moment later.
 */
export function nearestVariant(
  family: FontFamilyListing,
  want: Pick<Want, "weight" | "italic">,
): FontFamilyListing["variants"][number] | null {
  const slanted = family.variants.filter((variant) => variant.italic === want.italic);
  const pool = slanted.length > 0 ? slanted : family.variants;
  let best: FontFamilyListing["variants"][number] | null = null;
  for (const variant of pool) {
    if (!best || Math.abs(variant.weight - want.weight) < Math.abs(best.weight - want.weight)) {
      best = variant;
    }
  }
  return best;
}

export interface Fonts {
  /** The hosted catalogue, or null until it arrives — or for good, offline. */
  catalogue: FontsCatalogue | null;
  /** Changes whenever a face lands; a dependency for anything drawn in one. */
  version: number;
  /** The whole stack for a font id, hosted or shipped. */
  stack: (font: string) => string;
  /** Whether the face a style needs is loaded now. True for a macOS face. */
  loaded: (style: Want) => boolean;
  /** Loads the face a style needs, and says whether it is there afterwards. */
  ready: (style: Want) => Promise<boolean>;
  /** The variants a hosted family offers, or null for a macOS face. */
  variants: (font: string) => FontFamilyListing["variants"] | null;
}

export function useFonts(): Fonts {
  const [catalogue, setCatalogue] = useState<FontsCatalogue | null>(null);
  const [version, setVersion] = useState(generation);

  useEffect(() => {
    const listener = () => setVersion(generation);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.prequel.editor.fonts.catalogue().then((result) => {
      if (cancelled || !result.ok || !result.value) return;
      setCatalogue(result.value);
      bump();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const family = useCallback(
    (id: string) => catalogue?.families.find((candidate) => candidate.id === id) ?? null,
    [catalogue],
  );

  const stack = useCallback(
    (font: string) =>
      isSystemFont(font) || !family(font)
        ? captionFont(font).stack
        : `"${hostedFamily(font)}", ${FALLBACK}`,
    [family],
  );

  const loaded = useCallback(
    (style: Want) => {
      if (isSystemFont(style.font)) return true;
      const found = family(style.font);
      const variant = found ? nearestVariant(found, style) : null;
      if (!variant) return false;
      return faces.get(keyOf(style.font, variant))?.loaded ?? false;
    },
    [family],
  );

  const ready = useCallback(
    async (style: Want) => {
      if (isSystemFont(style.font)) return true;
      const found = family(style.font);
      const variant = found ? nearestVariant(found, style) : null;
      // Not in the catalogue, or the catalogue has not arrived: the fallback
      // draws it now, and the key says so, so it is redrawn when it can be.
      if (!variant) return false;

      const key = keyOf(style.font, variant);
      const known = faces.get(key);
      if (known) return known.done;

      const entry: Loading = { done: Promise.resolve(false), loaded: false };
      entry.done = (async () => {
        const fetched = await window.prequel.editor.fonts.ensure(variant.file);
        if (!fetched.ok || !fetched.value) return false;

        const face = new FontFace(hostedFamily(style.font), `url(${fontUrl(variant.file)})`, {
          weight: String(variant.weight),
          style: variant.italic ? "italic" : "normal",
        });
        document.fonts.add(face);
        try {
          await face.load();
        } catch (cause) {
          console.warn(`[fonts] could not load ${variant.file}:`, cause);
          return false;
        }
        // The status, not the promise: a face whose load settled unloaded is
        // one the engine will quietly draw the fallback for.
        entry.loaded = face.status === "loaded";
        bump();
        return entry.loaded;
      })();
      faces.set(key, entry);
      return entry.done;
    },
    [family],
  );

  const variants = useCallback((font: string) => family(font)?.variants ?? null, [family]);

  return useMemo(
    () => ({ catalogue, version, stack, loaded, ready, variants }),
    [catalogue, version, stack, loaded, ready, variants],
  );
}

function keyOf(font: string, variant: { weight: number; italic: boolean }): string {
  return `${font}:${String(variant.weight)}:${variant.italic ? "i" : "n"}`;
}

/** Everything a style says about its face, for callers holding a `TextStyle`. */
export function wantOf(style: TextStyle): Want {
  return { font: style.font, weight: style.weight, italic: style.italic };
}
