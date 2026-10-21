/**
 * The music library, as it is stored in R2 and served to the app.
 *
 * One schema held by both ends, exactly as the backgrounds are:
 * `scripts/upload-music.ts` validates what it is about to write and the route
 * validates what it reads back. The file in the bucket is the only thing
 * between them, so this is the only place their agreement is written down —
 * and a catalogue that fails to parse is caught where it was produced rather
 * than in an editor with an empty picker.
 *
 * One prefix rather than the backgrounds' two. A picture needs a thumbnail
 * because a swatch is eighty points across and the raw file is four megabytes;
 * a track has nothing to show, so the row is its name and its length and the
 * only object is the audio itself.
 */
import { z } from "zod";

/** Where the catalogue and its files sit in the bucket. */
export const MUSIC_PREFIX = "music";
export const MUSIC_CONFIG_KEY = `${MUSIC_PREFIX}/config.json`;
export const MUSIC_RAW_PREFIX = `${MUSIC_PREFIX}/raw`;

/**
 * Bumped when the shape changes in a way an older app cannot read.
 *
 * The app checks it and keeps whatever it had rather than throwing: a
 * catalogue it does not understand means a picker offering only what the
 * recording already holds, not an editor that will not open.
 */
export const MUSIC_VERSION = 1;

const entry = z.object({
  /** Stable across re-uploads: it is what a project stores. */
  id: z.string().min(1),
  label: z.string().min(1),
  /** The folder the file was found in, which is the group the picker shows. */
  category: z.string().min(1),
  /**
   * Key under `music/raw/`, and the name a recording copies it in as.
   *
   * `.m4a` throughout: it is the one audio container both halves of the
   * desktop app read without question — AVFoundation for the export, Chromium
   * for the preview — and the upload script converts to it.
   */
  file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.m4a$/),
  /**
   * MD5 of the bytes in the bucket.
   *
   * What makes a re-upload cheap: the script hashes each file, compares it
   * with the catalogue it is replacing, and skips anything unchanged.
   */
  md5: z.string().regex(/^[0-9a-f]{32}$/),
  bytes: z.number().int().positive(),
  /**
   * How long the track is, in nanoseconds.
   *
   * Nanoseconds because that is the clock the desktop app's timeline is on,
   * and a conversion at the boundary is a rounding error somebody would have
   * to find. Carried in the catalogue so a bed can be laid at the right width
   * the moment it is chosen, rather than resizing itself when the download
   * finishes.
   */
  duration: z.number().int().positive(),
  /** Who made it, where the licence asks for a credit. Empty where it does not. */
  attribution: z.string(),
});

export const musicConfig = z.object({
  version: z.literal(MUSIC_VERSION),
  /** When the catalogue was last written, ISO 8601. */
  updated: z.string().min(1),
  /** The order the picker shows groups in. Categories not listed come after. */
  categories: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })),
  tracks: z.array(entry),
});

export type MusicEntry = z.infer<typeof entry>;
export type MusicConfig = z.infer<typeof musicConfig>;
