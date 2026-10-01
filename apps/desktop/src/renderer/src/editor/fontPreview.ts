import type { Project } from "../../../shared/project";

/**
 * A face under the pointer in a font list, standing in for the one the project
 * carries while the pointer is there.
 *
 * Not a setting and never dispatched. A font list is a few dozen rows and the
 * pointer crosses most of them on the way to the one you want, so committing
 * each in turn would push an undo entry per row and mark the project dirty for
 * having been read — the list would cost more to look at than to use.
 *
 * So the hovered face is held beside the project instead, and applied to the
 * copy the preview draws from. `Editor` keeps exactly one of these: two lists
 * cannot be hovered at once, and a second would only make it possible for one
 * to be left behind.
 */
export type FontPreview =
  | { what: "captions"; font: string }
  /**
   * Which field of which text, because a text has a title and a subtitle with
   * a face each — and the weight alongside the face, because the list's own
   * `onChange` lands on a weight the family really has and a preview that did
   * not would draw a faked bold that the click then replaces. The picture
   * under the pointer has to be the picture you get.
   */
  | { what: "text"; textId: string; field: number; font: string; weight: number };

/**
 * The project as the preview should draw it, with the hovered face in place.
 *
 * Returns the project itself when nothing is hovered — identity, not a copy.
 * Everything downstream of this is keyed on identity or on a signature derived
 * from it, so a fresh object per render would re-rasterise every caption in the
 * recording sixty times a second.
 */
export function withFontPreview(project: Project, preview: FontPreview | null): Project {
  if (!preview) return project;

  if (preview.what === "captions") {
    return {
      ...project,
      defaults: {
        ...project.defaults,
        captions: { ...project.defaults.captions, captionFont: preview.font },
      },
      // A clip that sets its own caption font has to follow too, or hovering
      // the list does nothing on exactly the clip whose font you went to the
      // list to change.
      //
      // Only where the key is already there. Adding it everywhere would give
      // every clip a distinct caption look, and `useCaptions` rasterises one
      // set of cues per look — so a hover would draw the whole recording's
      // captions once per clip.
      tracks: project.tracks.map((track) => ({
        ...track,
        slices: track.slices.map((slice) =>
          slice.overrides.captions && "captionFont" in slice.overrides.captions
            ? {
                ...slice,
                overrides: {
                  ...slice.overrides,
                  captions: { ...slice.overrides.captions, captionFont: preview.font },
                },
              }
            : slice,
        ),
      })),
    };
  }

  // Each level left alone unless it holds the text being hovered, so the rows
  // and bitmaps of every other text keep their identity and nothing else is
  // laid out or drawn again.
  return {
    ...project,
    texts: project.texts.map((track) =>
      track.slices.some((text) => text.id === preview.textId)
        ? {
            ...track,
            slices: track.slices.map((text) =>
              text.id === preview.textId
                ? {
                    ...text,
                    fields: text.fields.map((field, index) =>
                      index === preview.field
                        ? {
                            ...field,
                            style: { ...field.style, font: preview.font, weight: preview.weight },
                          }
                        : field,
                    ),
                  }
                : text,
            ),
          }
        : track,
    ),
  };
}
