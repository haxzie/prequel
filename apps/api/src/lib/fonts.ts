/**
 * The font catalogue, as it is stored in R2 and served to the app.
 *
 * One schema held by both ends, for the reason `backgrounds.ts` gives:
 * `scripts/upload-fonts.ts` validates what it writes and the route validates
 * what it reads, and the file in the bucket is the only thing between them.
 *
 * The files live under `fonts/file/`, one per weight and slant of a family.
 * A family is listed with exactly the variants it has, so the editor never
 * offers a weight the engine would have to fake.
 */
import { z } from "zod";

/** Where the catalogue and its files sit in the bucket. */
export const FONTS_PREFIX = "fonts";
export const FONTS_CONFIG_KEY = `${FONTS_PREFIX}/config.json`;
export const FONTS_FILE_PREFIX = `${FONTS_PREFIX}/file`;

/**
 * Bumped when the shape changes in a way an older app cannot read.
 *
 * The app checks it and keeps the faces that ship with macOS rather than
 * throwing.
 */
export const FONTS_VERSION = 1;

const variant = z.object({
  /** 100 to 900, in hundreds. */
  weight: z.number().int().min(100).max(900).multipleOf(100),
  italic: z.boolean(),
  /** Key under `fonts/file/`. */
  file: z.string().min(1),
  /** MD5 of the bytes in the bucket, for the reason a background carries one. */
  md5: z.string().regex(/^[0-9a-f]{32}$/),
  bytes: z.number().int().positive(),
});

const family = z.object({
  /** Stable across re-uploads: it is what a project stores. */
  id: z.string().min(1),
  label: z.string().min(1),
  /** The group the picker shows it under: sans, serif, display, mono. */
  category: z.string().min(1),
  variants: z.array(variant).min(1),
});

export const fontsConfig = z.object({
  version: z.literal(FONTS_VERSION),
  /** When the catalogue was last written, ISO 8601. */
  updated: z.string().min(1),
  /** The order the picker shows groups in. Categories not listed come after. */
  categories: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })),
  families: z.array(family),
});

export type FontVariant = z.infer<typeof variant>;
export type FontFamily = z.infer<typeof family>;
export type FontsConfig = z.infer<typeof fontsConfig>;
