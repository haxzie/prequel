/**
 * The export request's slices: geometry and gain the exporter can render.
 *
 * Its own module, and not part of the export hook, because two things build
 * this now — the editor, with the caption and text bitmaps it has drawn, and a
 * headless `prequel render`, which has none. A second implementation for the
 * command line is exactly the failure `shared/layout.ts` warns about: a
 * rendered video and a preview that disagree about where the camera sits, with
 * nothing on screen or in the log to say why.
 *
 * Free of React, so main can import it.
 */
import {
  cursorImages,
  type EditorSession,
  type ExportSlice,
  type TrackMedia,
} from "../../../shared/contract";
import {
  buildRenderPlan,
  textOnClip,
  withWholeTimes,
  type CursorTag,
  type RenderedCue,
  type RenderedText,
  type Size,
} from "../../../shared/layout";
import { TRACK_KINDS, type TrackKind } from "../../../shared/manifest";
import {
  captionLook,
  clickSoundId,
  keySoundId,
  resolveSettings,
  type LayoutSettings,
  type Project,
} from "../../../shared/project";
import { segmentAt, segmentsOf } from "./segments";
// One reader of `project.tracks[0].slices`, even though it is a single line:
// a second would be another answer to "what is on the timeline" the day a
// project carries more than one track.
import { slicesOf } from "./state";
import { place, toProjectTime, type Slice } from "./timeline";

/**
 * Resolves every slice into geometry and gain the exporter can render.
 *
 * Exported for its own test rather than only through the hook: the per-slice
 * source sizes are what let a second take at a different resolution export
 * correctly, and getting them wrong renders a plausible, wrongly-cropped picture
 * with nothing in any log.
 */
export function buildSlices(
  session: EditorSession,
  project: Project,
  frame: Size,
  cues: ReadonlyMap<string, readonly RenderedCue[]>,
  texts: ReadonlyMap<string, RenderedText>,
  /**
   * The drawn label this clip's pointer wears, if any.
   *
   * A function rather than the map of rasterised tags, so this module knows
   * nothing about how they are keyed or drawn — the editor passes a lookup into
   * the bitmaps it has made, and a headless render passes one that always
   * answers none. Taking the map would have pulled the canvas that draws them
   * into the main process, which cannot run it.
   */
  tag: (layout: Pick<LayoutSettings, "cursorStyle" | "cursorName">) => CursorTag | undefined,
): ExportSlice[] {
  const all = slicesOf(project);
  const laid = place(all);

  return all.map((slice, index) => {
    // Every text resolved onto *this* clip, the way the preview resolves them
    // onto the one under the playhead. A text is pinned to the recording and
    // measured in the finished video, and the exporter samples a plan on the
    // recording's clock — so the crossing happens here, per clip. See
    // `PlacedText`.
    const clip = laid[index]!;
    const rows = project.texts.map((row) =>
      row.slices.flatMap((text) => {
        const from = toProjectTime(laid, text.at);
        if (from === null) return [];
        const span = textOnClip(from, text.length, clip);
        return span ? [{ text, span }] : [];
      }),
    );
    // Per slice, never hoisted. A recording extended with a take at a different
    // resolution has a different source size either side of the seam, and one
    // pair of dimensions used for every slice would crop take two against take
    // one's — which renders a plausible, wrongly-framed picture and says nothing
    // in any log.
    const media = sliceMedia(session, slice);
    const sources = {
      screen: sizeOf(media.screen),
      camera: sizeOf(media.camera),
    };
    const settings = resolveSettings(project.defaults, slice.overrides);
    // The slice before this one, so the camera arrives rather than teleports.
    // The first slice has nothing behind it and gets no transition, which is
    // what makes an export open on its composition rather than assembling it.
    const previous = index > 0 ? all[index - 1] : undefined;

    return {
      // Whole nanoseconds. A slice's times are written by the timeline, where
      // trimming maps pixels to time through a division, so a trimmed clip is
      // saved as something like `38277886131.081215` and stays that way. The
      // exporter reads these as `i64`, and a fraction fails the whole export
      // with `invalid type: floating point, expected i64` — nothing renders,
      // and the message names a number rather than a field.
      start: Math.round(slice.source.start),
      end: Math.round(slice.source.end),
      media: refsFor(media),
      // The same function the preview draws from, so the two cannot disagree
      // about where anything sits — with every time in it rounded to a whole
      // nanosecond on the way out, which the preview does not need and the
      // exporter cannot do without. See `withWholeTimes`.
      plan: withWholeTimes(
        buildRenderPlan(
          frame,
          sources,
          settings,
          session.cursor && {
            ...session.cursor,
            ...cursorImages(settings.layout.cursorStyle),
            tag: tag(settings.layout),
            size: settings.layout.cursorSize,
            hideAfter: settings.layout.cursorAutoHide ? settings.layout.cursorHideAfter : null,
            // Resolved here rather than in the plan, like `hideAfter`: a track
            // with no spans and one the user asked to keep the pointer through
            // are the same thing to draw.
            keys: settings.layout.cursorHideWhileTyping ? session.cursor.keys : [],
            // Unresolved: whether the shot looks at a field is not a question
            // about whether the pointer is drawn.
            typed: session.cursor.keys,
          },
          project.zooms,
          previous
            ? {
                from: resolveSettings(project.defaults, previous.overrides),
                source: slice.source,
              }
            : null,
          // This clip's own look. Caption settings are per clip, so a clip that
          // styles its captions differently is handed the set drawn for it —
          // and one whose captions are off has no look and gets nothing.
          //
          // Every cue in that set, not only the ones inside this clip: a caption
          // whose span falls outside simply never draws, and filtering here would
          // be a second answer to a question `captionAt` already answers per
          // frame.
          cues.get(captionLook(settings.captions)),
          // Only the texts that reach this clip, each carrying its whole life
          // in this clip's source time so an entrance is timed against its own
          // beginning rather than restarting at every cut it crosses.
          rows,
          texts,
          // The outline the recording fitted, for a camera shaped by it. Whole
          // track rather than this clip's slice of it: `blobAt` holds the first
          // and last sample past either end, so a clip that starts mid-take is
          // drawn with the shape that was there.
          session.blobs,
        ),
      ),
      speed: slice.speed,
      micVolume: settings.audio.micMuted ? 0 : settings.audio.micVolume,
      systemVolume: settings.audio.systemMuted ? 0 : settings.audio.systemVolume,
      // Through the same fallback the preview uses, so a keyboard this build
      // does not know exports as silence rather than as whatever the addon
      // makes of an unknown id.
      keySound: keySoundId(settings.audio.keySound),
      keySoundVolume: settings.audio.keySoundVolume,
      clickSound: clickSoundId(settings.audio.clickSound),
      clickSoundVolume: settings.audio.clickSoundVolume,
    };
  });
}

/**
 * Which segment of each kind this slice plays.
 *
 * A slice may never span a seam, so its start decides the whole of it — see the
 * guards in `sanitiseProject` and `trimSlice`, which is what makes one lookup
 * per slice sound rather than one per frame.
 */
function sliceMedia(session: EditorSession, slice: Slice): Partial<Record<TrackKind, TrackMedia>> {
  const found: Partial<Record<TrackKind, TrackMedia>> = {};

  for (const kind of TRACK_KINDS) {
    const segment = segmentAt(segmentsOf(session.media, kind), slice.source.start);
    if (segment) found[kind] = segment;
  }

  return found;
}

/** The file and offset the exporter needs, per kind. */
function refsFor(media: Partial<Record<TrackKind, TrackMedia>>): ExportSlice["media"] {
  const refs: ExportSlice["media"] = {};

  for (const kind of TRACK_KINDS) {
    const track = media[kind];
    if (!track) continue;
    refs[kind] = {
      file: track.file,
      offset: Math.round(track.offset),
      // A sidecar of the camera, written at the camera's timestamps from the
      // camera's origin, so it shares the camera's offset rather than carrying
      // one of its own.
      ...(track.matteFile ? { matte: track.matteFile } : {}),
    };
  }

  return refs;
}

/**
 * The recorded dimensions of one segment.
 *
 * Taken from the media itself where the probe found it, because the plan's
 * geometry depends on the real pixel size rather than on what the recorder
 * believed it wrote.
 */
function sizeOf(track: TrackMedia | undefined): { width: number; height: number } | null {
  return track?.width && track.height ? { width: track.width, height: track.height } : null;
}
