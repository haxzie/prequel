/**
 * One recording's edit, reduced to the single frame the library's tile draws.
 *
 * The grid used to show a frame of the raw screen track. That picture is the
 * one thing the finished video never looks like — no background, no padding, no
 * camera, and in a reframed project not even the right shape — so a library of
 * tiles said nothing about which edit was which. The tile composites instead,
 * through the same `buildRenderPlan` the preview and the exporter run, and this
 * is what decides which frame of which file it draws.
 *
 * Free of `electron` and of the filesystem, like everything else in `shared`:
 * main reads the two files off disk and the gallery fetches them, and both then
 * ask this the same question. Two implementations of "which frame is the tile"
 * would be a library and a set of documentation screenshots that quietly
 * disagreed.
 */
import type { ProjectComposition } from "./contract.js";
import type { Manifest, MediaTime, Segment } from "./manifest.js";
import { findTrack } from "./manifest.js";
import { AUTO_PRESET_ID } from "./presets.js";
import type { Project, Slice, SliceOverrides, SliceSettings } from "./project.js";
import { resolveSettings } from "./project.js";

/**
 * How far into the *kept* material the still is taken from.
 *
 * Into the edit rather than into the file: a recording usually opens on a click
 * or a window still settling, which is exactly the part a first cut trims away,
 * and a still taken at a quarter of the raw file can land in footage the video
 * no longer contains.
 */
const AT = 0.25;

/**
 * What the grid needs to draw this recording as its edit looks.
 *
 * `url` turns a file name beside the recording into something the renderer can
 * fetch — `prequel-media:` in the app, the gallery's own server in the gallery.
 */
export function composition(
  manifest: Manifest,
  project: Project,
  url: (file: string) => string,
): ProjectComposition {
  const moment = momentOf(
    project.tracks.flatMap((track) => track.slices),
    manifest.duration,
  );
  const settings = resolveSettings(project.defaults, moment.overrides);

  const camera = segmentAt(findTrack(manifest, "camera")?.segments, moment.at);
  const screen = segmentAt(findTrack(manifest, "screen")?.segments, moment.at);

  return {
    frame: {
      width: project.frame.width,
      height: project.frame.height,
      auto: project.frame.presetId === AUTO_PRESET_ID,
    },
    settings,
    screen: screen && { url: url(screen.segment.file_name), at: screen.at },
    camera: camera && {
      url: url(camera.segment.file_name),
      matteUrl: camera.segment.matte ? url(camera.segment.matte.file_name) : null,
      at: camera.at,
    },
    images: pictures(settings, url),
  };
}

/**
 * Where in the recording to take the still, and which clip's settings apply
 * there.
 *
 * Measured along the kept material and then mapped back onto the source clock,
 * so a trimmed recording is pictured from the part that survived. A project
 * with no slices at all — the take is empty — falls back to a quarter of the
 * way through the whole recording.
 */
function momentOf(
  slices: readonly Slice[],
  duration: MediaTime,
): { at: MediaTime; overrides: SliceOverrides | undefined } {
  const kept = slices.reduce((total, slice) => total + (slice.source.end - slice.source.start), 0);
  if (kept <= 0) return { at: duration * AT, overrides: undefined };

  let remaining = kept * AT;
  for (const slice of slices) {
    const length = slice.source.end - slice.source.start;
    if (remaining < length) {
      return { at: slice.source.start + remaining, overrides: slice.overrides };
    }
    remaining -= length;
  }

  // Only reachable on a rounding edge, where `remaining` lands exactly on the
  // end of the last slice. Its final frame is the honest answer.
  const last = slices[slices.length - 1]!;
  return { at: last.source.end, overrides: last.overrides };
}

/**
 * The segment covering a source time, and how far into its own file that is.
 *
 * **Zero-based files.** A track's late start lives only in the manifest, so the
 * segment's `start` is taken off here and nothing is probed from the file. A
 * camera that opened after the screen is otherwise seeked several hundred
 * milliseconds past where the tile means to look.
 *
 * Clamped rather than refused, because a moment chosen on the screen's clock
 * routinely falls outside a camera that opened late or was switched off early —
 * the nearest frame the camera has is a picture, and null is a tile with no
 * camera in it.
 */
function segmentAt(
  segments: readonly Segment[] | undefined,
  at: MediaTime,
): { segment: Segment; at: number } | null {
  if (!segments || segments.length === 0) return null;

  const segment =
    segments.find((candidate) => at >= candidate.start && at < candidate.end) ??
    (at < segments[0]!.start ? segments[0]! : segments[segments.length - 1]!);

  const inside = Math.min(Math.max(at, segment.start), segment.end) - segment.start;
  return { segment, at: inside / 1e9 };
}

/** Every picture the plan names by path, with the URL to fetch it over. */
function pictures(
  settings: SliceSettings,
  url: (file: string) => string,
): { path: string; url: string }[] {
  const paths = new Set<string>();

  const background = settings.background.background;
  if (background.kind === "image" && background.path) paths.add(background.path);
  if (settings.watermark.watermark) paths.add(settings.watermark.watermark);

  return [...paths].map((path) => ({ path, url: url(path) }));
}
