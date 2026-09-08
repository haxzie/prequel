/**
 * The scene-preset catalogue, as it is stored in R2 and served to the app.
 *
 * `scripts/upload-scene-presets.ts` validates what it is about to write and the
 * route validates what it reads back, exactly as the backgrounds do — the file
 * in the bucket is the only thing between them, so the schema is the only place
 * their agreement is written down.
 *
 * What is validated here is the **envelope**: the id, the name, the frame, the
 * card. The settings blocks are passed through as records on purpose. Their real
 * shape lives in `apps/desktop/src/shared/project.ts`, which this Worker may not
 * import — the boundary that keeps `shared/` from acquiring a second consumer —
 * and `sanitiseScenePreset` on the desktop side spreads every block over the
 * app's own defaults anyway. Restating thirty layout keys here would be a second
 * definition of them, and the one that drifts.
 */
import { z } from "zod";

/** Where the catalogue and its cards sit in the bucket. */
export const SCENE_PRESETS_PREFIX = "scene-presets";
export const SCENE_PRESETS_CONFIG_KEY = `${SCENE_PRESETS_PREFIX}/config.json`;
export const SCENE_PRESETS_THUMBNAIL_PREFIX = `${SCENE_PRESETS_PREFIX}/thumbnail`;

/**
 * Bumped when the shape changes in a way an older app cannot read.
 *
 * The app checks it and keeps whatever it had rather than throwing: a catalogue
 * it does not understand means a picker with only the user's own looks in it,
 * not an editor that will not open.
 */
export const SCENE_PRESETS_VERSION = 1;

/** Settings blocks travel as-is; the desktop is what knows their shape. */
const block = z.record(z.string(), z.unknown());

const entry = z.object({
  /**
   * Stable across re-uploads, and a bare name: the desktop serves a card by its
   * id through `prequel-media://`, so an id is a file name.
   */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  savedAt: z.number(),
  frame: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /**
     * Never `"auto"`. Automatic is not a size — it is the absence of choosing
     * one — and the editor writes the recording's own size straight back over
     * it, so a published preset carrying it would have its frame silently
     * discarded and its undo appear not to work. Refused here, where whoever
     * published it is still looking at the terminal.
     */
    presetId: z
      .string()
      .refine((id) => id !== "auto", "a preset may not carry the automatic frame")
      .nullable(),
  }),
  layout: block,
  background: block,
  captions: block,
  zoom: block,
  /** MD5 of the card in the bucket, so a re-upload can skip an unchanged one. */
  md5: z.string().regex(/^[0-9a-f]{32}$/),
  /**
   * A BlurHash of the card, for the picker to draw while it loads. Small enough
   * to sit in the catalogue rather than being fetched.
   */
  blurhash: z.string().min(6),
});

export const scenePresetsConfig = z.object({
  version: z.literal(SCENE_PRESETS_VERSION),
  /** When the catalogue was last written, ISO 8601. */
  updated: z.string().min(1),
  presets: z.array(entry),
});

export type ScenePresetEntry = z.infer<typeof entry>;
export type ScenePresetsConfig = z.infer<typeof scenePresetsConfig>;
