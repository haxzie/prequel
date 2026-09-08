/**
 * A BlurHash as something a `background-image` can take.
 *
 * Lifted out of `BackgroundSwatch` when the scene preset cards needed the same
 * thing. One decode cache rather than two — and the cache is the point, not an
 * optimisation: both pickers re-render on every unrelated edit, and decoding
 * thirty of these per keystroke is a panel that visibly stops.
 */
import { decode } from "blurhash";

/** What the hash is decoded at. It is four by three components; this is plenty. */
const HASH_SIZE = 32;

/** Decoded once per hash and kept, for the life of the window. */
const decoded = new Map<string, string | null>();

export function hashUrl(hash: string | undefined): string | null {
  if (!hash) return null;

  const cached = decoded.get(hash);
  if (cached !== undefined) return cached;

  let url: string | null = null;
  try {
    const pixels = decode(hash, HASH_SIZE, HASH_SIZE);
    const canvas = document.createElement("canvas");
    canvas.width = HASH_SIZE;
    canvas.height = HASH_SIZE;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      const image = ctx.createImageData(HASH_SIZE, HASH_SIZE);
      image.data.set(pixels);
      ctx.putImageData(image, 0, 0);
      url = canvas.toDataURL();
    }
  } catch {
    // A hash the decoder will not take is one cell without a placeholder, not a
    // picker that fails to draw.
    url = null;
  }

  decoded.set(hash, url);
  return url;
}
