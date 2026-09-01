/**
 * The background catalogue, as it is stored in R2 and served to the app.
 *
 * One schema, held by both ends: `scripts/upload-backgrounds.mjs` validates
 * what it is about to write, and the route below validates what it reads back.
 * The file in the bucket is the only thing between them, so the schema is the
 * only place their agreement is written down — and a catalogue that fails to
 * parse is caught where it was produced rather than in an editor with a blank
 * picker.
 *
 * The pictures themselves live under two prefixes: `backgrounds/raw/` for what
 * a recording copies in, and `backgrounds/thumbnail/` for what the picker
 * draws. A swatch is 80 pixels across; handing it a 3200-pixel JPEG is four
 * megabytes to draw a postage stamp.
 */
import { z } from "zod";

/** Where the catalogue and its pictures sit in the bucket. */
export const BACKGROUNDS_PREFIX = "backgrounds";
export const BACKGROUNDS_CONFIG_KEY = `${BACKGROUNDS_PREFIX}/config.json`;
export const BACKGROUNDS_RAW_PREFIX = `${BACKGROUNDS_PREFIX}/raw`;
export const BACKGROUNDS_THUMBNAIL_PREFIX = `${BACKGROUNDS_PREFIX}/thumbnail`;

/**
 * Bumped when the shape changes in a way an older app cannot read.
 *
 * The app checks it and keeps whatever it had rather than throwing: a
 * catalogue it does not understand means the shipped pictures, not an editor
 * that will not open.
 */
export const BACKGROUNDS_VERSION = 1;

const entry = z.object({
  /** Stable across re-uploads: it is what a project stores. */
  id: z.string().min(1),
  label: z.string().min(1),
  /** The folder the picture was found in, which is the group the picker shows. */
  category: z.string().min(1),
  /** Key under `backgrounds/raw/`, and the name a recording copies it in as. */
  file: z.string().min(1),
  /**
   * MD5 of the bytes in the bucket.
   *
   * What makes a re-upload cheap: the script hashes each file, compares it with
   * the catalogue it is replacing, and skips anything unchanged. Also what lets
   * the app tell a picture that was edited from one that was merely renamed.
   */
  md5: z.string().regex(/^[0-9a-f]{32}$/),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /**
   * A BlurHash of the picture, for the picker to draw while the thumbnail
   * loads. Small enough to sit in the catalogue rather than being fetched.
   */
  blurhash: z.string().min(6),
});

export const backgroundsConfig = z.object({
  version: z.literal(BACKGROUNDS_VERSION),
  /** When the catalogue was last written, ISO 8601. */
  updated: z.string().min(1),
  /** The order the picker shows groups in. Categories not listed come after. */
  categories: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })),
  backgrounds: z.array(entry),
});

export type BackgroundEntry = z.infer<typeof entry>;
export type BackgroundsConfig = z.infer<typeof backgroundsConfig>;
